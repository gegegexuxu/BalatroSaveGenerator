// 使用说明弹窗（PROJECT_SPEC.md 9）：标题 + 操作步骤 / 风险警示 / 可自定义三块，无标题栏容器 + Toast
import { h } from './dom';

const STORAGE_KEY = 'bsg_usage_seen';

export function createUsageModal(): { root: HTMLElement; open(): void } {
  const close = (): void => overlay.classList.remove('show');

  const okBtn = h('button', { class: 'btn btn-blue', text: '知道了' });
  okBtn.addEventListener('click', close);

  const steps = h('ol', {
    html: [
      '选好牌组与赌注，点击 <b>导出存档</b> 下载 <b>save.jkr</b>（文件名保持不变）；',
      '完全关闭游戏（若有进行中的对局，先退出）；',
      '资源管理器地址栏粘贴 <b>%APPDATA%\\Balatro</b> 打开存档目录，进入对应的存档位文件夹' +
        '（<b>1 / 2 / 3 对应主菜单的三个存档位</b>），用 save.jkr 覆盖其中的同名文件；',
      '启动游戏，主菜单点击 <b>继续游戏</b>。',
    ].map(s => `<li>${s}</li>`).join(''),
  });

  const customs = h('ul', {
    html: [
      '<b>基础参数</b>：出牌/弃牌、手牌上限、小丑与消耗牌槽位、金币、种子',
      '<b>修改牌组</b>：点击牌组卡面进入，可逐张调整牌面（增强/蜡封/版本）、增删卡牌',
      '<b>起始配备</b>：消耗牌（可带负片）、小丑牌（版本与永恒/易腐/租用贴纸）、优惠券',
    ].map(s => `<li>${s}</li>`).join(''),
  });

  const box = h('div', { class: 'modal-box usage' }, [
    h('div', { class: 'modal-body' }, [
      h('h2', { class: 'usage-title', text: '使用说明' }),
      h('p', { class: 'usage-sub', text: '把生成的 save.jkr 放进游戏，只需 4 步' }),
      h('div', { class: 'usage-sec', text: '操作步骤' }),
      steps,
      h('p', { class: 'modal-alert', text: '覆盖存档有风险，操作前建议先备份原存档 · 适用游戏版本 1.0.1o' }),
      h('div', { class: 'usage-sec', text: '可自定义（以下内容均会写入存档）' }),
      customs,
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
