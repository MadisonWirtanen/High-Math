/**
 * scripts/ts-resolve-hook.mjs
 *
 * Node 的 ESM 解析要求显式扩展名，而 Next 项目里的 import 是省略 `.ts` 的。
 * 这个 loader hook 在解析失败时补上 `.ts`，让脚本能直接复用项目源码。
 */

export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
      return next(specifier + '.ts', context);
    }
    throw err;
  }
}
