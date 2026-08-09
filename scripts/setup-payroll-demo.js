// Creates a reusable, non-zero daily payroll demo on Staging.
// The safety check prevents payroll calculation if any real employee is eligible for the demo period.
const { Client } = require('pg');
const { getConfig } = require('./lib/env.js');

const COMPANY_ID = 'comp_kc_clean';
const EMP_ID = 'DEMOPAY001';

function connectionString(databaseUrl) {
  const match = databaseUrl.match(/^(.*?:\/\/)([^:\/\?#]+):([^@]+)@(.*)$/);
  return match
    ? `${match[1]}${match[2]}:${encodeURIComponent(match[3])}@${match[4]}`
    : databaseUrl;
}

async function run() {
  const { DATABASE_URL } = getConfig();
  if (!DATABASE_URL) throw new Error('DATABASE_URL is not configured');

  const client = new Client({ connectionString: connectionString(DATABASE_URL) });
  await client.connect();

  try {
    await client.query('BEGIN');

    const workDateResult = await client.query('SELECT CURRENT_DATE AS work_date');
    const workDate = workDateResult.rows[0].work_date;

    const realEligibleEmployees = await client.query(`
      SELECT emp_id
      FROM public.employees
      WHERE company_id = $1
        AND status IN ('active', 'hired')
        AND salary_type IN ('monthly', 'daily')
        AND COALESCE(pay_frequency, CASE WHEN salary_type = 'monthly' THEN 'monthly' ELSE NULL END) = 'daily'
        AND emp_id NOT LIKE 'DEMO%'
    `, [COMPANY_ID]);
    if (realEligibleEmployees.rowCount > 0) {
      throw new Error(`Safety stop: daily payroll would include non-demo employees: ${realEligibleEmployees.rows.map(row => row.emp_id).join(', ')}`);
    }

    const employeeResult = await client.query(`
      SELECT id
      FROM public.employees
      WHERE company_id = $1 AND emp_id = $2
      ORDER BY created_at
      LIMIT 1
    `, [COMPANY_ID, EMP_ID]);

    let employeeId;
    if (employeeResult.rowCount > 0) {
      employeeId = employeeResult.rows[0].id;
      await client.query(`
        UPDATE public.employees
        SET full_name = 'พนักงานสาธิต Payroll รายวัน',
            status = 'active',
            salary_type = 'daily',
            employment_type = 'regular',
            pay_frequency = 'daily',
            daily_rate = 600,
            hourly_rate = 75,
            standard_working_hours = 8,
            standard_monthly_hours = 208,
            social_security_base = 600,
            social_security_employee_rate = 0.05,
            social_security_employer_rate = 0.05,
            updated_at = timezone('utc', now())
        WHERE id = $1
      `, [employeeId]);
    } else {
      const insertedEmployee = await client.query(`
        INSERT INTO public.employees (
          full_name, emp_id, company_id, status, salary_type, employment_type,
          pay_frequency, daily_rate, hourly_rate, standard_working_hours,
          standard_monthly_hours, social_security_base,
          social_security_employee_rate, social_security_employer_rate
        )
        VALUES (
          'พนักงานสาธิต Payroll รายวัน', $1, $2, 'active', 'daily', 'regular',
          'daily', 600, 75, 8, 208, 600, 0.05, 0.05
        )
        RETURNING id
      `, [EMP_ID, COMPANY_ID]);
      employeeId = insertedEmployee.rows[0].id;
    }

    const clientResult = await client.query(`
      SELECT id
      FROM public.clients
      WHERE company_id = $1
      ORDER BY created_at
      LIMIT 1
    `, [COMPANY_ID]);
    if (clientResult.rowCount === 0) throw new Error('No demo client/site is available');
    const clientId = clientResult.rows[0].id;

    const shiftResult = await client.query(`
      SELECT id
      FROM public.employee_shift_assignments
      WHERE employee_id = $1 AND effective_from <= $2
        AND (effective_to IS NULL OR effective_to >= $2)
      ORDER BY effective_from DESC
      LIMIT 1
    `, [employeeId, workDate]);
    if (shiftResult.rowCount > 0) {
      await client.query(`
        UPDATE public.employee_shift_assignments
        SET company_id = $1, shift_start = '08:00', shift_end = '17:00',
            standard_hours = 8, weekly_rest_day = 0
        WHERE id = $2
      `, [COMPANY_ID, shiftResult.rows[0].id]);
    } else {
      await client.query(`
        INSERT INTO public.employee_shift_assignments (
          company_id, employee_id, shift_start, shift_end, standard_hours,
          weekly_rest_day, effective_from
        )
        VALUES ($1, $2, '08:00', '17:00', 8, 0, $3)
      `, [COMPANY_ID, employeeId, workDate]);
    }

    const attendanceResult = await client.query(`
      SELECT id
      FROM public.attendance_logs
      WHERE employee_id = $1 AND work_date = $2
      ORDER BY created_at DESC
      LIMIT 1
    `, [employeeId, workDate]);
    let attendanceId;
    if (attendanceResult.rowCount > 0) {
      attendanceId = attendanceResult.rows[0].id;
      await client.query(`
        UPDATE public.attendance_logs
        SET emp_id = $1, company_id = $2, client_id = $3,
            check_in = '08:00', check_out = '18:00', total_hours = 10,
            status = 'present', check_in_method = 'demo'
        WHERE id = $4
      `, [EMP_ID, COMPANY_ID, clientId, attendanceId]);
    } else {
      const insertedAttendance = await client.query(`
        INSERT INTO public.attendance_logs (
          employee_id, emp_id, company_id, client_id, work_date,
          check_in, check_out, total_hours, status, check_in_method
        )
        VALUES ($1, $2, $3, $4, $5, '08:00', '18:00', 10, 'present', 'demo')
        RETURNING id
      `, [employeeId, EMP_ID, COMPANY_ID, clientId, workDate]);
      attendanceId = insertedAttendance.rows[0].id;
    }

    const otRequestResult = await client.query(`
      SELECT id
      FROM public.ot_requests
      WHERE employee_id = $1 AND work_date = $2
      ORDER BY created_at
      LIMIT 1
    `, [employeeId, workDate]);
    if (otRequestResult.rowCount > 0) {
      await client.query(`
        UPDATE public.ot_requests
        SET requested_hours = 2, reason = 'ข้อมูลสาธิต Payroll: OT หลังเลิกงาน',
            status = 'approved', resolved_approver_role = 'admin',
            updated_at = timezone('utc', now())
        WHERE id = $1
      `, [otRequestResult.rows[0].id]);
    } else {
      await client.query(`
        INSERT INTO public.ot_requests (
          company_id, employee_id, emp_id, work_date, requested_hours,
          reason, status, resolved_approver_role
        )
        VALUES ($1, $2, $3, $4, 2, 'ข้อมูลสาธิต Payroll: OT หลังเลิกงาน', 'approved', 'admin')
      `, [COMPANY_ID, employeeId, EMP_ID, workDate]);
    }
    await client.query('SELECT public.fn_materialize_attendance_ot($1)', [attendanceId]);

    const periodResult = await client.query(`
      SELECT id
      FROM public.payroll_periods
      WHERE company_id = $1 AND period_type = 'daily'
        AND period_start = $2 AND period_end = $2
        AND status IN ('draft', 'open')
      ORDER BY created_at DESC
      LIMIT 1
    `, [COMPANY_ID, workDate]);
    let periodId;
    if (periodResult.rowCount > 0) {
      periodId = periodResult.rows[0].id;
    } else {
      const insertedPeriod = await client.query(`
        INSERT INTO public.payroll_periods (
          company_id, period_type, period_start, period_end, pay_date, status
        )
        VALUES ($1, 'daily', $2, $2, $2::date + 1, 'open')
        RETURNING id
      `, [COMPANY_ID, workDate]);
      periodId = insertedPeriod.rows[0].id;
    }

    const existingDemoRun = await client.query(`
      SELECT r.id
      FROM public.payroll_runs r
      JOIN public.payroll_lines l ON l.payroll_run_id = r.id
      WHERE r.period_id = $1 AND l.employee_id = $2 AND l.net_pay > 0
      ORDER BY r.created_at DESC
      LIMIT 1
    `, [periodId, employeeId]);

    let runId;
    if (existingDemoRun.rowCount > 0) {
      runId = existingDemoRun.rows[0].id;
    } else {
      const createdRun = await client.query(
        'SELECT public.fn_run_payroll_period($1, NULL) AS run_id',
        [periodId]
      );
      runId = createdRun.rows[0].run_id;
    }

    const summaryResult = await client.query(`
      SELECT r.id AS run_id, r.total_gross_amount, r.total_deductions, r.total_net_amount,
             COUNT(l.id)::integer AS employee_count
      FROM public.payroll_runs r
      LEFT JOIN public.payroll_lines l ON l.payroll_run_id = r.id
      WHERE r.id = $1
      GROUP BY r.id
    `, [runId]);
    const demoLineResult = await client.query(`
      SELECT l.id, l.emp_id, l.base_salary, l.ot15_hours, l.overtime_amount,
             l.social_security_employee, l.net_pay
      FROM public.payroll_lines l
      WHERE l.payroll_run_id = $1 AND l.employee_id = $2
    `, [runId, employeeId]);
    if (demoLineResult.rowCount !== 1 || Number(demoLineResult.rows[0].net_pay) <= 0) {
      throw new Error('Payroll demo verification failed: expected one non-zero DEMOPAY001 line');
    }

    await client.query('COMMIT');
    console.log(JSON.stringify({
      period_id: periodId,
      work_date: workDate,
      run: summaryResult.rows[0],
      demo_line: demoLineResult.rows[0],
    }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

run().catch(error => {
  console.error(`Payroll demo setup failed: ${error.message}`);
  process.exit(1);
});
