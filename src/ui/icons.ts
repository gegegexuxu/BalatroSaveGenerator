// 游戏 UI 小图标：Resources/ui_asset/ui_{x}_{y}.png（= 游戏 ui_1 图集 18×18 切片，assets/ui/）
// 图集坐标语义来自 UI_definitions.lua:3368-3378 的 tally_sprite 调用（牌组视图的统计图标）
const uiImages = import.meta.glob('../../assets/ui/ui_*.png', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>;

export function uiIcon(name: string): string | undefined {
  return uiImages[`../../assets/ui/${name}.png`];
}

export const SUIT_ICON: Record<string, string> = {
  S: 'ui_3_1', H: 'ui_0_1', C: 'ui_2_1', D: 'ui_1_1',
};

export const TALLY_ICON = {
  ace: 'ui_1_0',
  face: 'ui_2_0',
  number: 'ui_3_0',
} as const;
