# 药视通 YaoShiTong

**拍下药盒，用法用量念给您听。**

面向老人、视障朋友和需要用药帮助的人的 AI 药品识别助手：拍照识别药盒 → AI 读出药名和说明书 → 大字展示 + 语音播报。**不用打字、不用看小字**，拍一下就能听。

## ✨ 功能特性

- 📷 **拍照识别**：调用后置摄像头 / 从相册选择 / 3 张内置示例图一键演示
- 🤖 **AI 识别**：药名、规格、适应症、用法用量、禁忌、注意事项（智谱 GLM-4V-Flash，国内直连、免费模型）
- 📚 **本地药库兜底**：内置 24 种常用药自动补充；AI 信息不足时生成通用说明并明确提示核对
- 🔊 **语音播报**：一键播报 / 再读一遍 / 随时停止（MiniMax TTS，中文自然音、语速放缓，适合老人）
- 💬 **继续询问**：识别后可语音提问（支持主要方言与口音普通话）、点选快捷问题或打字，回答自动播报
- 💊 **剂量说人话**：「一次 0.25g」按包装规格换算成「一次 1 粒」——用确定性规则计算，不让模型口算
- ✅ **国内数据库核验**：接入易源数据药品说明书库，按「批准文号 → 生产企业/规格 → 代码打分」三层链路验证识别结果
- ⚠️ **安全提醒**：处方药红色大字 + 语音双重提醒；页面底部常驻免责声明

## 🚀 快速开始

环境要求：Node.js 18+（推荐 20+）。

```bash
# 1. 克隆项目
git clone https://github.com/你的用户名/yaoshitong.git
cd yaoshitong

# 2. 安装依赖
npm install

# 3. 配置密钥（复制模板并填入真实 Key）
cp .env.local.example .env.local    # Windows 命令行用: copy .env.local.example .env.local

# 4. 启动
npm run dev
```

浏览器打开 `http://localhost:3000` 即可使用。

> **Windows 用户更省事的方式**：双击项目里的 `预览.bat`（自动构建并打开浏览器）和 `填写密钥.bat`（自动打开密钥配置文件）。手机连同一 Wi-Fi 后用 `预览.bat` 窗口里打印的局域网地址访问，即可真机拍照测试（配合 `放行手机访问.bat` 放行防火墙）。
>
> 如果中文文件名导致双击闪退，请改用同名英文版本：`preview.bat`、`fill-keys.bat`、`allow-phone.bat`。
>
> 如果 `.bat` 仍然一闪而过，可能是系统对批处理文件的执行被拦截或关联损坏，请尝试：
>
> - 双击 `preview.cmd`（CMD 版本）
> - 双击 `preview.vbs`（无黑窗脚本，最稳定）
> - 或在文件夹空白处按住 `Shift` 点右键 → **在此处打开 PowerShell 窗口** / **终端**，然后运行 `npm run build` 和 `npm run start`

## 🔑 环境变量

| 变量 | 用途 | 申请 |
| --- | --- | --- |
| `ZHIPU_API_KEY` | 药盒图片识别 + 语音转文字 + 问答 | [智谱开放平台](https://open.bigmodel.cn) → 控制台 → API Keys（`glm-4v-flash` / `glm-4-flash` 均为免费模型） |
| `MINIMAX_API_KEY` | 语音播报 TTS | [MiniMax 开放平台](https://platform.minimaxi.com) → 账户管理 |
| `MINIMAX_GROUP_ID` | 部分账号调语音接口必填 | 同 MiniMax 账户管理页 |
| `YIYUAN_APP_KEY` | 国内药品说明书数据库核验（易源数据） | [万维易源](https://www.showapi.com) → 搜索「药品说明书」 |
| `ALLOWED_ORIGINS` | 可选：额外信任的前端域名（逗号分隔） | 默认同源请求自动放行，一般用不到 |
| `TTS_VOICE_ID` / `TTS_LANGUAGE_BOOST` / `TTS_SPEED` | 可选：换音色 / 加粤语 / 调速 | 见 `.env.example` 内注释 |

改完 `.env.local` 需要重启服务生效。

## ☁️ 一键部署到 Vercel

项目可直接部署到 [Vercel](https://vercel.com)（免费）：

1. 把项目推送到自己的 GitHub 仓库
2. 登录 Vercel → **Import** 该仓库
3. 在项目的 **Settings → Environment Variables** 里添加 `ZHIPU_API_KEY`、`MINIMAX_API_KEY`、`YIYUAN_APP_KEY`（按需加 `MINIMAX_GROUP_ID`）
4. 点 **Deploy**，一两分钟后获得公开网址，手机扫码即用

## 🛡️ 安全设计

- **密钥只在服务端**：前端无任何 Key，浏览器只调本项目自己的 `/api/*` 接口，由服务端用环境变量转发到智谱 / MiniMax / 易源数据
- **接口防滥用**：所有 `/api/*` 带来源校验 + 按 IP 频率限制（`lib/server-guard.ts`）
- **密钥永不入库**：`.gitignore` 拦截 `.env*` 与证书文件；仓库里的 `.env.example` 只有占位符
- **防误传**：内置 gitleaks 配置与 pre-commit 钩子（`git config core.hooksPath .githooks`），建议同时开启 GitHub 的 Secret scanning 与 Push protection

详见 [SECURITY.md](./SECURITY.md)（密钥放哪、泄露应急）和 [RELEASE-CHECKLIST.md](./RELEASE-CHECKLIST.md)（发布前检查清单）。

## 📁 目录结构

```
app/
  page.tsx              单页主界面（上传 → 识别 → 展示 → 播报 → 继续询问）
  api/recognize/        识别接口：智谱视觉模型 + 本地药库 + 通用信息兜底
  api/ask/              文字问答接口
  api/ask-audio/        语音提问接口（glm-asr 转写）
  api/tts/              语音合成接口：代理 MiniMax，密钥只在服务端
components/             上传按钮、示例图选择器、结果卡片、语音控制、询问面板
data/common-medicines.json  本地常用药库（24 种，可增删）
public/samples/         3 张示例药盒图（Wikimedia Commons 实景照片，见夹内 README.txt）
lib/
  verification/         易源数据三层验证链路：规则、API 适配器、主链路
  drug-verification/    海外/公开数据库交叉验证（openFDA、RxNorm 等）
  server-guard.ts       API 护栏：来源校验 + 按 IP 限流
  text-guard.ts         输出守门：跑题过滤、注射提醒、剂量复核
  dose-translate.ts     剂量换算：克数 → 几粒几片（确定性规则）
  image.ts              图片压缩（保住小字边缘，上传更快）
scripts/lan-ip.js       打印局域网 IP（手机访问用）
```

## ❓ 常见问题

| 现象 | 解决办法 |
| --- | --- |
| 提示「服务器还没配置智谱 API Key」 | `.env.local` 没建或没填，填完**重启**服务 |
| 提示「API Key 无效」 | 重新去控制台复制，注意不要多空格 |
| 手机上没有「拍照识别」按钮 | 必须是手机真机访问；电脑浏览器只有相册选择 |
| 手机打不开 `http://电脑IP:3000` | 确认同一 Wi-Fi；尝试手机开热点让电脑连；或以管理员运行 `放行手机访问.bat`；终极方案是部署 Vercel 用公网地址 |
| 启动报 `Failed to load SWC binary for win32/ia32` | 本机 Node 是 32 位，换装 64 位 Node（LTS）即可 |

## ⚠️ 免责声明

本工具识别结果由 AI 生成，可能因拍摄角度、光线、包装版本等原因出现错误，**仅供参考，不能替代医生和药师**。实际用药请仔细阅读药盒内说明书，并遵医嘱。页面底部已常驻此声明。

## 📄 许可

代码以 [MIT](./LICENSE) 协议开源。`public/samples/` 内示例图片来自 Wikimedia Commons，出处与许可见该目录 [README.txt](./public/samples/README.txt)。
