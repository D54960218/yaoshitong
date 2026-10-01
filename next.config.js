/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 使用 .babelrc 走 Babel 编译、关闭 SWC 压缩（Terser 替代），少依赖原生二进制
  swcMinify: false,
};

module.exports = nextConfig;
