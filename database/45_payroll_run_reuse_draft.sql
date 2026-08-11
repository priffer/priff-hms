-- =====================================================
-- database/45_payroll_run_reuse_draft.sql
-- Reuse draft payroll_runs on re-run instead of always inserting.
--
-- Rules:
--   - Only reuse rows with status = 'draft' (never approved/locked/etc.)
--   - If a period has only non-draft runs, INSERT a new draft
--   - Clearing old lines/payslips/details + rewriting happens in the same
--     function transaction (SECURITY DEFINER call is atomic)
--   - Refresh run_name / run_date / updated_at on reuse
--   - Reverse YTD + fully-linked advances for the reused draft before rewrite
--
-- period_id is the UUID PK of payroll_periods (globally unique), so a partial
-- unique index on (period_id) WHERE status='draft' is sufficient without company_id.
-- That index is applied in 46 after duplicate draft cleanup is confirmed.
-- Idempotent: CREATE OR REPLACE FUNCTION
-- =====================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_run_payroll_period(p_period_id uuid, p_created_by uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period record;
  v_run_id uuid;
  v_emp record;
  v_line_id uuid;
  v_company text;
  v_tax_year integer;

  -- rates
  v_ot15_mult numeric; v_ot2_mult numeric; v_ot3_mult numeric;
  v_ss_emp_rate numeric; v_ss_employer_rate numeric; v_ss_cap numeric;
  v_freelance_wht_rate numeric; v_night_shift_rate numeric;
  v_allow record;

  -- per-employee accumulators
  v_hourly_rate numeric;
  v_standard_hours numeric;
  v_base_salary numeric;
  v_worked_hours numeric;
  v_worked_days integer;
  v_ot15_hours numeric; v_ot2_hours numeric; v_ot3_hours numeric;
  v_ot_amount numeric;
  v_absence_days numeric;
  v_absence_deduction numeric;
  v_day_rate_equivalent numeric;
  v_night_shift_days integer;
  v_night_shift_amount numeric;
  v_gross_pay numeric;
  v_ss_employee numeric; v_ss_employer numeric;
  v_annual_income_estimate numeric;
  v_periods_per_year numeric;
  v_taxable_income numeric;
  v_annual_tax numeric;
  v_withholding_tax numeric;
  v_advance_available numeric;
  v_advance_deduction numeric;
  v_net_pay numeric;
  v_has_weekly_flag boolean;
  v_calendar_days integer;
  v_expected_workdays integer;
  v_leave_days numeric;
  v_payslip_number text;
  v_ytd record;
  v_advance record;
  v_remaining_advance numeric;
BEGIN
  SELECT * INTO v_period FROM public.payroll_periods WHERE id = p_period_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payroll_periods % not found', p_period_id;
  END IF;

  v_company := v_period.company_id;
  v_tax_year := EXTRACT(YEAR FROM v_period.period_end)::integer;
  v_calendar_days := (v_period.period_end - v_period.period_start + 1);

  -- โหลดอัตราปัจจุบัน (ล่าสุดที่ effective_from <= period_end)
  SELECT rate_value INTO v_ot15_mult FROM public.payroll_rates WHERE company_id = v_company AND rate_type = 'ot_15' AND effective_from <= v_period.period_end ORDER BY effective_from DESC LIMIT 1;
  SELECT rate_value INTO v_ot2_mult FROM public.payroll_rates WHERE company_id = v_company AND rate_type = 'ot_2' AND effective_from <= v_period.period_end ORDER BY effective_from DESC LIMIT 1;
  SELECT rate_value INTO v_ot3_mult FROM public.payroll_rates WHERE company_id = v_company AND rate_type = 'ot_3' AND effective_from <= v_period.period_end ORDER BY effective_from DESC LIMIT 1;
  SELECT rate_value, social_security_max_cap INTO v_ss_emp_rate, v_ss_cap FROM public.payroll_rates WHERE company_id = v_company AND rate_type = 'social_security_employee' AND effective_from <= v_period.period_end ORDER BY effective_from DESC LIMIT 1;
  SELECT rate_value INTO v_ss_employer_rate FROM public.payroll_rates WHERE company_id = v_company AND rate_type = 'social_security_employer' AND effective_from <= v_period.period_end ORDER BY effective_from DESC LIMIT 1;
  SELECT rate_value INTO v_freelance_wht_rate FROM public.payroll_rates WHERE company_id = v_company AND rate_type = 'freelance_withholding_tax' AND effective_from <= v_period.period_end ORDER BY effective_from DESC LIMIT 1;
  SELECT rate_value INTO v_night_shift_rate FROM public.payroll_rates WHERE company_id = v_company AND rate_type = 'night_shift_differential' AND effective_from <= v_period.period_end ORDER BY effective_from DESC LIMIT 1;

  v_ot15_mult := COALESCE(v_ot15_mult, 1.5);
  v_ot2_mult := COALESCE(v_ot2_mult, 2.0);
  v_ot3_mult := COALESCE(v_ot3_mult, 3.0);
  v_ss_emp_rate := COALESCE(v_ss_emp_rate, 0.05);
  v_ss_employer_rate := COALESCE(v_ss_employer_rate, 0.05);
  v_ss_cap := COALESCE(v_ss_cap, 875);
  v_freelance_wht_rate := COALESCE(v_freelance_wht_rate, 0.03);
  v_night_shift_rate := COALESCE(v_night_shift_rate, 0.10);

  SELECT * INTO v_allow FROM public.payroll_tax_allowance_defaults WHERE company_id = v_company AND tax_year = v_tax_year;
  IF NOT FOUND THEN
    v_allow.standard_expense_deduction := 60000;
    v_allow.personal_allowance := 60000;
    v_allow.child_allowance_per_child := 30000;
  END IF;

  -- Reuse the newest draft run for this period only.
  -- Never overwrite approved/locked/submitted/etc. If none is draft, INSERT a new draft.
  SELECT id INTO v_run_id
  FROM public.payroll_runs
  WHERE id = (
    SELECT id FROM public.payroll_runs
    WHERE period_id = p_period_id AND status = 'draft'
    ORDER BY created_at DESC
    LIMIT 1
  )
  FOR UPDATE;

  IF v_run_id IS NOT NULL THEN
    -- Reverse YTD that this draft previously contributed (same transaction as rewrite)
    UPDATE public.payroll_ytd_summary y SET
      ytd_income = GREATEST(COALESCE(y.ytd_income, 0) - s.gross_pay, 0),
      ytd_social_security = GREATEST(COALESCE(y.ytd_social_security, 0) - s.ss, 0),
      ytd_tax_paid = GREATEST(COALESCE(y.ytd_tax_paid, 0) - s.tax, 0),
      updated_at = timezone('utc'::text, now())
    FROM (
      SELECT employee_id, company_id,
             COALESCE(SUM(gross_pay), 0) AS gross_pay,
             COALESCE(SUM(social_security_employee), 0) AS ss,
             COALESCE(SUM(withholding_tax), 0) AS tax
      FROM public.payroll_lines
      WHERE payroll_run_id = v_run_id
      GROUP BY employee_id, company_id
    ) s
    WHERE y.employee_id = s.employee_id
      AND y.company_id = s.company_id
      AND y.tax_year = v_tax_year;

    -- Undo advances fully marked against this draft run so they can be re-applied
    UPDATE public.advance_payments SET
      status = 'approved',
      deducted_amount = 0,
      deducted_in_payroll_run_id = NULL
    WHERE deducted_in_payroll_run_id = v_run_id;

    DELETE FROM public.payroll_payslips WHERE payroll_run_id = v_run_id;
    DELETE FROM public.payroll_line_details
      WHERE payroll_line_id IN (SELECT id FROM public.payroll_lines WHERE payroll_run_id = v_run_id);
    DELETE FROM public.payroll_lines WHERE payroll_run_id = v_run_id;

    -- Refresh run metadata so UI does not keep the old timestamp/name
    UPDATE public.payroll_runs SET
      run_name = 'Payroll Run ' || to_char(now(), 'YYYY-MM-DD HH24:MI'),
      run_date = timezone('utc'::text, now()),
      run_type = v_period.period_type,
      created_by = COALESCE(p_created_by, created_by),
      total_gross_amount = 0,
      total_deductions = 0,
      total_net_amount = 0,
      updated_at = timezone('utc'::text, now())
    WHERE id = v_run_id;
  ELSE
    INSERT INTO public.payroll_runs (period_id, company_id, run_name, run_type, status, created_by, run_date, updated_at)
    VALUES (
      p_period_id, v_company,
      'Payroll Run ' || to_char(now(), 'YYYY-MM-DD HH24:MI'),
      v_period.period_type, 'draft', p_created_by,
      timezone('utc'::text, now()), timezone('utc'::text, now())
    )
    RETURNING id INTO v_run_id;
  END IF;

  -- วน loop พนักงานที่ active, ตั้งค่า salary_type ไว้แล้ว และ pay_frequency ตรงกับ period_type ของงวดนี้
  -- (Milestone 5 Phase 2: กันไม่ให้พนักงานรายเดือนโดนคำนวณซ้ำถ้ามีคนรันงวดรายวัน/กึ่งเดือนผิดพลาด)
  FOR v_emp IN
    SELECT * FROM public.employees
    WHERE company_id = v_company
      AND status IN ('active', 'hired')
      AND salary_type IN ('monthly', 'daily')
      AND COALESCE(pay_frequency, CASE WHEN salary_type = 'monthly' THEN 'monthly' ELSE NULL END) = v_period.period_type
  LOOP
    v_standard_hours := COALESCE(v_emp.standard_working_hours, 8);
    v_ot15_hours := 0; v_ot2_hours := 0; v_ot3_hours := 0;
    v_has_weekly_flag := false;

    -- ชั่วโมงทำงานจริงในงวด + จำนวนวันที่มาทำงาน
    SELECT COALESCE(SUM(al.total_hours), 0), COUNT(*) FILTER (WHERE al.total_hours IS NOT NULL)
    INTO v_worked_hours, v_worked_days
    FROM public.attendance_logs al
    WHERE al.employee_id = v_emp.id AND al.company_id = v_company
      AND al.work_date BETWEEN v_period.period_start AND v_period.period_end;

    -- OT แยกประเภทจาก attendance_ot_details (materialize ไว้แล้วจาก 25_attendance_ot_materialize.sql)
    SELECT
      COALESCE(SUM(aod.ot_hours) FILTER (WHERE aod.ot_type = 'ot15'), 0),
      COALESCE(SUM(aod.ot_hours) FILTER (WHERE aod.ot_type = 'ot2'), 0),
      COALESCE(SUM(aod.ot_hours) FILTER (WHERE aod.ot_type = 'ot3'), 0)
    INTO v_ot15_hours, v_ot2_hours, v_ot3_hours
    FROM public.attendance_ot_details aod
    JOIN public.attendance_logs al ON al.id = aod.attendance_log_id
    WHERE aod.employee_id = v_emp.id AND aod.company_id = v_company
      AND al.work_date BETWEEN v_period.period_start AND v_period.period_end;

    -- ตรวจสอบว่ามีสัปดาห์ใดในงวดนี้ที่ weekly_ot_flagged = true หรือไม่ (docs §4.7 - ต้องบล็อกอนุมัติอัตโนมัติ)
    SELECT EXISTS (
      SELECT 1 FROM public.attendance_logs al
      WHERE al.employee_id = v_emp.id AND al.company_id = v_company
        AND al.work_date BETWEEN v_period.period_start AND v_period.period_end
        AND al.weekly_ot_flagged = true
    ) INTO v_has_weekly_flag;

    -- ลาที่อนุมัติแล้วในงวดนี้ (รวมทั้งวันเต็มและราย ชม. - total_days ถูกคำนวณไว้แล้วฝั่ง DB ใน leave_requests)
    SELECT COALESCE(SUM(lr.total_days), 0) INTO v_leave_days
    FROM public.leave_requests lr
    WHERE lr.employee_id = v_emp.id AND lr.company_id = v_company AND lr.status = 'approved'
      AND lr.start_date <= v_period.period_end AND lr.end_date >= v_period.period_start;

    -- [A] ค่าแรงพื้นฐาน + ชั่วโมง/ชม.
    IF v_emp.salary_type = 'monthly' THEN
      v_base_salary := COALESCE(v_emp.monthly_salary, 0);
      v_hourly_rate := CASE WHEN COALESCE(v_emp.standard_monthly_hours, 0) > 0
        THEN v_emp.monthly_salary / v_emp.standard_monthly_hours ELSE 0 END;
      v_day_rate_equivalent := v_hourly_rate * v_standard_hours;
    ELSE -- daily
      v_hourly_rate := CASE WHEN v_standard_hours > 0
        THEN COALESCE(v_emp.daily_rate, 0) / v_standard_hours ELSE 0 END;
      v_base_salary := COALESCE(v_emp.daily_rate, 0) * v_worked_days;
      v_day_rate_equivalent := COALESCE(v_emp.daily_rate, 0);
    END IF;

    -- จำนวนวันทำงานที่ควรมา = วันในงวด - วันนักขัตฤกษ์ - วันหยุดประจำสัปดาห์ (ถ้าตั้งค่าไว้)
    -- ใช้เพื่อประมาณ absence_days ของพนักงานรายเดือน (รายวันไม่ต้องคิด เพราะจ่ายเท่าที่มาจริงอยู่แล้ว)
    SELECT COUNT(*) INTO v_expected_workdays
    FROM generate_series(v_period.period_start, v_period.period_end, interval '1 day') d(day)
    WHERE NOT EXISTS (SELECT 1 FROM public.company_holidays ch WHERE ch.company_id = v_company AND ch.holiday_date = d.day::date)
      AND NOT EXISTS (
        SELECT 1 FROM public.employee_shift_assignments esa
        WHERE esa.employee_id = v_emp.id
          AND esa.effective_from <= d.day::date AND (esa.effective_to IS NULL OR esa.effective_to >= d.day::date)
          AND esa.weekly_rest_day IS NOT NULL AND esa.weekly_rest_day = EXTRACT(DOW FROM d.day)::integer
      );

    IF v_emp.salary_type = 'monthly' THEN
      v_absence_days := GREATEST(v_expected_workdays - v_worked_days - v_leave_days, 0);
      v_absence_deduction := v_absence_days * v_hourly_rate * v_standard_hours;
    ELSE
      v_absence_days := 0; -- รายวันไม่จ่ายวันที่ขาดอยู่แล้ว (ไม่มีค่าแรงวันนั้นตั้งแต่แรก)
      v_absence_deduction := 0;
    END IF;

    -- OT amount
    v_ot_amount := (v_ot15_hours * v_ot15_mult + v_ot2_hours * v_ot2_mult + v_ot3_hours * v_ot3_mult) * v_hourly_rate;

    -- ค่ากะดึก (Milestone 5 Phase 1) - นับวันที่มาทำงานจริงในงวดนี้ที่กะที่ผูกไว้ ณ วันนั้นข้ามเที่ยงคืน
    -- (shift_end < shift_start) คูณด้วยค่าแรง/วันฐาน x อัตราที่ตั้งไว้ (default 10% - ปรับได้ผ่าน payroll_rates)
    SELECT COUNT(*) INTO v_night_shift_days
    FROM public.attendance_logs al
    JOIN public.employee_shift_assignments esa
      ON esa.employee_id = al.employee_id
      AND al.work_date >= esa.effective_from AND (esa.effective_to IS NULL OR al.work_date <= esa.effective_to)
    WHERE al.employee_id = v_emp.id AND al.company_id = v_company
      AND al.work_date BETWEEN v_period.period_start AND v_period.period_end
      AND al.total_hours IS NOT NULL
      AND esa.shift_end < esa.shift_start;

    v_night_shift_amount := v_night_shift_days * v_day_rate_equivalent * v_night_shift_rate;

    v_gross_pay := v_base_salary - v_absence_deduction + v_ot_amount + v_night_shift_amount;
    IF v_gross_pay < 0 THEN v_gross_pay := 0; END IF;

    -- ประกันสังคม + ภาษี: แยกตาม employment_type (Milestone 5 Phase 1)
    IF v_emp.employment_type = 'freelance' THEN
      -- ฟรีแลนซ์/จ็อบพิเศษ: ไม่มีสัญญาจ้าง ไม่หักประกันสังคม + หัก ณ ที่จ่ายคงที่ (ตามมาตรา 3 เตรส)
      v_ss_employee := 0;
      v_ss_employer := 0;
      v_withholding_tax := ROUND(v_gross_pay * v_freelance_wht_rate, 2);
    ELSE
      -- พนักงานประจำ: ประกันสังคม ม.33 MIN(ฐาน x 5%, 875) ต่อเดือน + ภาษีตารางขั้นบันได (annualization method)
      v_ss_employee := LEAST(COALESCE(v_emp.social_security_base, v_base_salary) * COALESCE(v_emp.social_security_employee_rate, v_ss_emp_rate), v_ss_cap);
      v_ss_employer := LEAST(COALESCE(v_emp.social_security_base, v_base_salary) * COALESCE(v_emp.social_security_employer_rate, v_ss_employer_rate), v_ss_cap);

      -- [B] ภาษีหัก ณ ที่จ่าย - annualization method (Milestone 5 Phase 2: เพิ่ม semimonthly = 24 งวด/ปี)
      v_periods_per_year := CASE
        WHEN v_period.period_type = 'monthly' THEN 12
        WHEN v_period.period_type = 'semimonthly' THEN 24
        ELSE 260
      END;
      v_annual_income_estimate := v_gross_pay * v_periods_per_year;
      v_taxable_income := v_annual_income_estimate - v_allow.standard_expense_deduction - v_allow.personal_allowance
        - (COALESCE(v_emp.tax_allowance_child, 0) * v_allow.child_allowance_per_child) - COALESCE(v_emp.tax_allowance_other, 0);
      IF v_taxable_income < 0 THEN v_taxable_income := 0; END IF;

      SELECT COALESCE(SUM(
        GREATEST(LEAST(v_taxable_income, COALESCE(tb.income_to, v_taxable_income)) - tb.income_from, 0) * tb.tax_rate
      ), 0) INTO v_annual_tax
      FROM public.payroll_tax_brackets tb
      WHERE tb.company_id = v_company AND tb.tax_year = v_tax_year AND tb.income_from < v_taxable_income;

      v_withholding_tax := ROUND(v_annual_tax / v_periods_per_year, 2);
    END IF;

    -- [C] เงินเบิกล่วงหน้า - หักเต็มจำนวนที่ยังไม่ถูกหัก เท่าที่ net_pay เหลือพอ
    v_net_pay := v_gross_pay - v_ss_employee - v_withholding_tax;
    IF v_net_pay < 0 THEN v_net_pay := 0; END IF;

    v_advance_deduction := 0;
    FOR v_advance IN
      SELECT * FROM public.advance_payments
      WHERE emp_id = v_emp.emp_id AND company_id = v_company
        AND status = 'approved' AND deducted_in_payroll_run_id IS NULL
      ORDER BY request_date ASC
    LOOP
      v_remaining_advance := v_advance.amount - COALESCE(v_advance.deducted_amount, 0);
      IF v_remaining_advance <= 0 THEN CONTINUE; END IF;

      IF v_net_pay - v_advance_deduction <= 0 THEN EXIT; END IF;

      IF v_remaining_advance <= (v_net_pay - v_advance_deduction) THEN
        v_advance_deduction := v_advance_deduction + v_remaining_advance;
        UPDATE public.advance_payments SET
          status = 'paid', deducted_in_payroll_run_id = v_run_id,
          deducted_amount = v_advance.amount
        WHERE id = v_advance.id;
      ELSE
        -- หักได้ไม่ครบ - หักเท่าที่เหลือ ค้างส่วนที่เหลือไว้งวดถัดไป (ไม่ mark deducted_in_payroll_run_id)
        v_advance_deduction := v_advance_deduction + (v_net_pay - v_advance_deduction);
        UPDATE public.advance_payments SET
          deducted_amount = COALESCE(deducted_amount, 0) + (v_net_pay - v_advance_deduction)
        WHERE id = v_advance.id;
      END IF;
    END LOOP;

    v_net_pay := v_net_pay - v_advance_deduction;
    IF v_net_pay < 0 THEN v_net_pay := 0; END IF;

    -- เขียน payroll_lines
    INSERT INTO public.payroll_lines
      (payroll_run_id, company_id, employee_id, emp_id, base_salary, base_hours, worked_hours,
       ot15_hours, ot2_hours, ot3_hours, overtime_amount, gross_pay, withholding_tax,
       absence_deduction, advance_deduction, social_security_employee, social_security_employer,
       other_deductions, net_pay, pay_status, remarks)
    VALUES
      (v_run_id, v_company, v_emp.id, v_emp.emp_id, v_base_salary, v_standard_hours * v_expected_workdays, v_worked_hours,
       v_ot15_hours, v_ot2_hours, v_ot3_hours, v_ot_amount, v_gross_pay, v_withholding_tax,
       v_absence_deduction, v_advance_deduction, v_ss_employee, v_ss_employer,
       0, v_net_pay,
       CASE WHEN v_has_weekly_flag THEN 'needs_review' ELSE 'pending' END,
       CASE WHEN v_has_weekly_flag THEN 'ต้องตรวจสอบ: มีสัปดาห์ที่ OT เกิน 36 ชม. ในงวดนี้ (docs §4.7) ห้ามอนุมัติอัตโนมัติ' ELSE NULL END)
    RETURNING id INTO v_line_id;

    -- payroll_line_details: รายละเอียดย่อยแยกประเภท
    INSERT INTO public.payroll_line_details (payroll_line_id, company_id, detail_type, description, amount, quantity, rate)
    VALUES
      (v_line_id, v_company, 'base', 'ค่าจ้างพื้นฐาน (' || v_emp.salary_type || ')', v_base_salary, v_worked_days, v_hourly_rate),
      (v_line_id, v_company, 'ot15', 'OT 1.5x (วันทำงานปกติ)', v_ot15_hours * v_hourly_rate * v_ot15_mult, v_ot15_hours, v_hourly_rate * v_ot15_mult),
      (v_line_id, v_company, 'ot2', 'OT 2.0x (วันหยุดประจำสัปดาห์)', v_ot2_hours * v_hourly_rate * v_ot2_mult, v_ot2_hours, v_hourly_rate * v_ot2_mult),
      (v_line_id, v_company, 'ot3', 'OT 3.0x (วันนักขัตฤกษ์)', v_ot3_hours * v_hourly_rate * v_ot3_mult, v_ot3_hours, v_hourly_rate * v_ot3_mult),
      (v_line_id, v_company, 'night_shift', 'ค่ากะดึก (+' || (v_night_shift_rate * 100)::text || '%)', v_night_shift_amount, v_night_shift_days, v_day_rate_equivalent * v_night_shift_rate),
      (v_line_id, v_company, 'absence', 'หักขาดงาน', -v_absence_deduction, v_absence_days, v_hourly_rate * v_standard_hours),
      (v_line_id, v_company, 'social_security', 'ประกันสังคม (พนักงาน)', -v_ss_employee, 1, CASE WHEN v_emp.employment_type = 'freelance' THEN 0 ELSE v_ss_emp_rate END),
      (v_line_id, v_company, 'withholding_tax', 'ภาษีหัก ณ ที่จ่าย' || CASE WHEN v_emp.employment_type = 'freelance' THEN ' (ฟรีแลนซ์ 3%)' ELSE '' END, -v_withholding_tax, 1, CASE WHEN v_emp.employment_type = 'freelance' THEN v_freelance_wht_rate ELSE NULL END),
      (v_line_id, v_company, 'advance', 'หักเงินเบิกล่วงหน้า', -v_advance_deduction, 1, NULL);

    -- payroll_payslips
    v_payslip_number := 'PS-' || to_char(v_period.period_end, 'YYYYMM') || '-' || v_emp.emp_id || '-' || substr(v_run_id::text, 1, 8);
    INSERT INTO public.payroll_payslips
      (payroll_line_id, company_id, employee_id, payroll_run_id, payslip_number, payslip_date,
       gross_amount, deduction_amount, net_amount, status)
    VALUES
      (v_line_id, v_company, v_emp.id, v_run_id, v_payslip_number, v_period.pay_date,
       v_gross_pay, (v_gross_pay - v_net_pay), v_net_pay,
       CASE WHEN v_has_weekly_flag THEN 'draft' ELSE 'draft' END);

    -- YTD summary
    SELECT * INTO v_ytd FROM public.payroll_ytd_summary WHERE employee_id = v_emp.id AND company_id = v_company AND tax_year = v_tax_year;
    IF FOUND THEN
      UPDATE public.payroll_ytd_summary SET
        ytd_income = ytd_income + v_gross_pay,
        ytd_social_security = ytd_social_security + v_ss_employee,
        ytd_tax_paid = ytd_tax_paid + v_withholding_tax,
        updated_at = timezone('utc'::text, now())
      WHERE id = v_ytd.id;
    ELSE
      INSERT INTO public.payroll_ytd_summary (company_id, employee_id, tax_year, ytd_income, ytd_social_security, ytd_tax_paid)
      VALUES (v_company, v_emp.id, v_tax_year, v_gross_pay, v_ss_employee, v_withholding_tax);
    END IF;

  END LOOP;

  -- อัพเดตยอดรวม + timestamp ของ payroll_runs (ทั้ง insert ใหม่และ reuse)
  UPDATE public.payroll_runs pr SET
    total_gross_amount = agg.total_gross,
    total_deductions = agg.total_gross - agg.total_net,
    total_net_amount = agg.total_net,
    run_date = timezone('utc'::text, now()),
    updated_at = timezone('utc'::text, now())
  FROM (
    SELECT COALESCE(SUM(gross_pay), 0) AS total_gross, COALESCE(SUM(net_pay), 0) AS total_net
    FROM public.payroll_lines WHERE payroll_run_id = v_run_id
  ) agg
  WHERE pr.id = v_run_id;

  RETURN v_run_id;
END;
$$;

COMMIT;

-- Verification
-- SELECT public.fn_run_payroll_period('<period_id>', NULL);
-- SELECT id, period_id, status, run_name, run_date, updated_at, total_net_amount
-- FROM public.payroll_runs WHERE period_id = '<period_id>' ORDER BY created_at;
