// 使用说明弹窗（PROJECT_SPEC.md 9）+ Toast
import { h } from './dom';

const STORAGE_KEY = 'bsg_usage_seen';

export function createUsageModal(): { root: HTMLElement; open(): void } {
  const close = (): void => overlay.classList.remove('show');

  const okBtn = h('button', { class: 'btn btn-blue', text: '知道了' });
  okBtn.addEventListener('click', close);

  const steps = h('ol', {
    html: [
      '选择牌组与赌注（白注~金注），点击 <b>导出存档</b> 下载 <b>save.jkr</b>；',
      '关闭游戏（若游戏内已有进行中的对局）；',
      '将文件放入 <b>%APPDATA%\\Balatro\\&lt;存档位 1~3&gt;\\</b>，覆盖同名文件（<b>覆盖前建议备份原存档</b>）；',
      '启动游戏，主菜单点击 <b>继续游戏</b>。',
    ].map(s => `<li>${s}</li>`).join(''),
  });

  const box = h('div', { class: 'modal-box' }, [
    h('div', { class: 'modal-title', text: '使用说明' }),
    h('div', { class: 'modal-body' }, [
      steps,
      h('p', { class: 'modal-warn', text: '· 当前版本：牌组与赌注选择，出牌/弃牌/金币/种子可自定义；其余牌组规则（手牌上限等）暂未应用' }),
      h('p', { class: 'modal-warn', text: '· 适用游戏版本 1.0.1o；覆盖存档有风险，请先备份' }),
    ]),
    h('div', { class: 'modal-actions' }, [okBtn]),
  ]);

  const overlay = h('div', { class: 'modal-overlay' }, [box]);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  return {
    root: overlay,
    open: () => overlay.classList.add('show'),
  };
}

/** 首次访问自动弹出一次 */
export function autoShowOnce(modal: { open(): void }): void {
  try {
    if (!localStorage.getItem(STORAGE_KEY)) {
      modal.open();
      localStorage.setItem(STORAGE_KEY, '1');
    }
  } catch {
    /* localStorage 不可用时跳过 */
  }
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function showToast(msg: string): void {
  const el = document.querySelector<HTMLElement>('.toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}
