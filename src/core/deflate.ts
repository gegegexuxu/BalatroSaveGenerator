// raw deflate（level 1，无 zlib 头）压缩，与 love.data.compress('deflate', ..., 1) 一致（PROJECT_SPEC.md 5.1）
import { deflateSync } from 'fflate';

export function deflateSave(luaSource: string): Uint8Array {
  return deflateSync(new TextEncoder().encode(luaSource), { level: 1 });
}
