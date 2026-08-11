// Shared confirm / alert modal for Admin Portal pages.
// Replaces native window.confirm() / window.alert().
//
// Usage:
//   const ok = await PriffConfirm.confirm('ยืนยันหรือไม่?');
//   await PriffConfirm.alert('บันทึกสำเร็จ');
//   await PriffConfirm.alert('ผิดพลาด', { variant: 'error' });

(function initPriffConfirm(global) {
  const STYLE_ID = 'priff-confirm-modal-style';
  const ROOT_ID = 'priffConfirmModalRoot';

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${ROOT_ID} {
        position: fixed; inset: 0; z-index: 9999;
        display: none; align-items: center; justify-content: center;
        padding: 1rem; background: rgba(15, 23, 42, 0.6);
      }
      #${ROOT_ID}.priff-confirm-open { display: flex; }
      #${ROOT_ID} .priff-confirm-panel {
        width: 100%; max-width: 28rem;
        background: #fff; border-radius: 2rem;
        border: 1px solid #e6edf7;
        box-shadow: 0 16px 40px rgba(15, 43, 115, 0.15);
        overflow: hidden;
      }
      #${ROOT_ID} .priff-confirm-header {
        padding: 1.25rem 1.5rem; border-bottom: 1px solid #e6edf7;
        background: #f8fafc; display: flex; align-items: center; gap: 0.75rem;
      }
      #${ROOT_ID} .priff-confirm-title {
        margin: 0; font-size: 1.125rem; font-weight: 800; color: #0f2b73;
      }
      #${ROOT_ID} .priff-confirm-body {
        padding: 1.5rem; color: #334155; font-size: 0.95rem; line-height: 1.6;
        white-space: pre-wrap; word-break: break-word;
      }
      #${ROOT_ID} .priff-confirm-footer {
        padding: 1rem 1.5rem; border-top: 1px solid #e6edf7; background: #f8fafc;
        display: flex; justify-content: flex-end; gap: 0.75rem;
      }
      #${ROOT_ID} .priff-confirm-btn {
        border-radius: 0.75rem; padding: 0.5rem 1.5rem; font-size: 0.875rem;
        font-weight: 700; cursor: pointer; border: 1px solid #e6edf7;
        transition: background-color 0.15s ease, color 0.15s ease;
      }
      #${ROOT_ID} .priff-confirm-btn-cancel {
        background: #fff; color: #0f2b73;
      }
      #${ROOT_ID} .priff-confirm-btn-cancel:hover { background: #eef5ff; }
      #${ROOT_ID} .priff-confirm-btn-ok {
        background: #165dff; color: #fff; border-color: #165dff;
      }
      #${ROOT_ID} .priff-confirm-btn-ok:hover { background: #0f2b73; }
      #${ROOT_ID} .priff-confirm-btn-danger {
        background: #dc2626; color: #fff; border-color: #dc2626;
      }
      #${ROOT_ID} .priff-confirm-btn-danger:hover { background: #b91c1c; }
    `;
    document.head.appendChild(style);
  }

  function ensureRoot() {
    let root = document.getElementById(ROOT_ID);
    if (root) return root;
    root = document.createElement('div');
    root.id = ROOT_ID;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.innerHTML = `
      <div class="priff-confirm-panel">
        <div class="priff-confirm-header">
          <h3 class="priff-confirm-title" id="priffConfirmTitle">ยืนยัน</h3>
        </div>
        <div class="priff-confirm-body" id="priffConfirmMessage"></div>
        <div class="priff-confirm-footer">
          <button type="button" class="priff-confirm-btn priff-confirm-btn-cancel" id="priffConfirmCancel">ยกเลิก</button>
          <button type="button" class="priff-confirm-btn priff-confirm-btn-ok" id="priffConfirmOk">ตกลง</button>
        </div>
      </div>
    `;
    document.body.appendChild(root);
    return root;
  }

  let activeResolver = null;
  let keyHandler = null;

  function close(result) {
    const root = document.getElementById(ROOT_ID);
    if (root) root.classList.remove('priff-confirm-open');
    if (keyHandler) {
      document.removeEventListener('keydown', keyHandler);
      keyHandler = null;
    }
    const resolve = activeResolver;
    activeResolver = null;
    if (resolve) resolve(result);
  }

  function openDialog({ title, message, mode, variant, confirmLabel, cancelLabel }) {
    ensureStyles();
    const root = ensureRoot();
    const titleEl = root.querySelector('#priffConfirmTitle');
    const msgEl = root.querySelector('#priffConfirmMessage');
    const okBtn = root.querySelector('#priffConfirmOk');
    const cancelBtn = root.querySelector('#priffConfirmCancel');

    titleEl.textContent = title;
    msgEl.textContent = message == null ? '' : String(message);

    const isDanger = variant === 'error' || variant === 'danger';
    okBtn.textContent = confirmLabel || (mode === 'confirm' ? 'ยืนยัน' : 'ตกลง');
    okBtn.className = 'priff-confirm-btn ' + (isDanger ? 'priff-confirm-btn-danger' : 'priff-confirm-btn-ok');

    cancelBtn.textContent = cancelLabel || 'ยกเลิก';
    cancelBtn.style.display = mode === 'confirm' ? '' : 'none';

    if (activeResolver) close(false);

    return new Promise((resolve) => {
      activeResolver = resolve;
      okBtn.onclick = () => close(true);
      cancelBtn.onclick = () => close(false);
      keyHandler = (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          close(mode === 'confirm' ? false : true);
        } else if (event.key === 'Enter') {
          event.preventDefault();
          close(true);
        }
      };
      document.addEventListener('keydown', keyHandler);
      root.classList.add('priff-confirm-open');
      okBtn.focus();
    });
  }

  const PriffConfirm = {
    confirm(message, options = {}) {
      return openDialog({
        title: options.title || 'ยืนยัน',
        message,
        mode: 'confirm',
        variant: options.variant || 'default',
        confirmLabel: options.confirmLabel,
        cancelLabel: options.cancelLabel,
      });
    },
    alert(message, options = {}) {
      return openDialog({
        title: options.title || (options.variant === 'error' ? 'เกิดข้อผิดพลาด' : 'แจ้งเตือน'),
        message,
        mode: 'alert',
        variant: options.variant || 'default',
        confirmLabel: options.confirmLabel || 'ตกลง',
      }).then(() => undefined);
    },
  };

  global.PriffConfirm = PriffConfirm;
})(window);
