# 安全说明（SECURITY.md）

这份文件说清楚三件事：**密钥该放哪**、**项目自带哪些防护**、**万一泄露了怎么办**。
使用者（下载代码的人）只需要看第一节；仓库维护者建议全看。

---

## 一、密钥该放哪（使用者和部署者必读）

**原则：真实密钥永远不进代码仓库，只待在两个地方之一。**

| 场景 | 密钥放哪 |
| --- | --- |
| 本地开发（自己电脑跑） | 项目根目录的 **`.env.local`** 文件（已配置为永不提交）。双击 `填写密钥.bat` 会自动建好并打开它 |
| 部署到 Vercel 等线上平台 | 平台后台的 **Environment Variables（环境变量）** 设置页，**不要**把 `.env.local` 一起传上去 |

本项目需要的密钥（均有免费额度）：

| 变量名 | 用途 | 申请地址 |
| --- | --- | --- |
| `ZHIPU_API_KEY` | 识别药盒图片 + 语音转文字 + 问答 | https://open.bigmodel.cn → 控制台 → API Keys |
| `MINIMAX_API_KEY` | 语音播报（TTS） | https://platform.minimaxi.com → 账户管理 |
| `MINIMAX_GROUP_ID` | 部分 MiniMax 账号必填 | 同上页面，和 API Key 放在一起 |
| `YIYUAN_APP_KEY` | 国内药品说明书数据库（易源数据），用于三层验证链路 | https://www.showapi.com → 搜索「药品说明书」 |
| `OPENFDA_API_KEY` | 外部药品数据库 openFDA 验证（可选，不填也能用） | https://open.fda.gov/apis/authentication/ |

申请后照抄到对应位置即可；`.env.example` / `.env.local.example` 两个模板文件里
只有占位符，照抄模板格式填写，**不要把 Key 写进任何别的文件**。

## 二、项目自带的防护（已实现，无需配置）

1. **代理模式**：前端代码里没有任何密钥。浏览器只调用本项目自己的 `/api/*` 接口，
   由服务端用环境变量里的 Key 去调智谱 / MiniMax / 易源数据 / openFDA 等外部服务（见 `app/api/`、`lib/drug-verification/adapters/` 与 `lib/verification/`）。
   即使抓包也只能看到本项目的接口，看不到真实第三方 Key。
2. **`.gitignore` 拦截**：`.env`、`.env.*`、证书文件（`*.pem`/`*.key`）一律不允许提交，
   只有两个 `.example` 模板可以上传。
3. **来源检查**：所有 `/api/*` 接口会核验请求来源，别的网站不能偷偷调你的接口
   烧你的额度（`lib/server-guard.ts`）。跨域名部署时用 `ALLOWED_ORIGINS` 加白名单。
4. **频率限制**：同一 IP 每分钟各接口可调用次数有上限（识别 12 次、问答 30 次、
   语音转文字 20 次、语音合成 90 次），正常家用很宽松，只拦恶意刷屏。
5. **提交前扫描**：安装 gitleaks 并启用钩子后，每次 `git commit` 自动检查有没有误带密钥。

## 三、启用提交前扫描（仓库维护者，2 分钟）

```bash
# 1. 安装 gitleaks（Windows 任选其一）
winget install gitleaks
#   或：scoop install gitleaks

# 2. 在本项目根目录执行一次，让 Git 启用 .githooks 里的钩子
git config core.hooksPath .githooks
```

装完后每次提交自动扫描；没装也只是跳过并提示，不影响使用。

## 四、GitHub 侧必开的两个开关（公开仓库强烈建议）

在仓库页面：**Settings → Code security and analysis**

1. **Secret scanning** —— 公开仓库默认开启，检测到密钥会发邮件提醒；
2. **Push protection** —— 手动打开。开启后 `git push` 时若带疑似密钥，GitHub 会直接拦截。
   这是最后一道保险，比任何本地检查都可靠。

## 五、万一密钥泄露了怎么办（按顺序做）

> 判断标准：Key 出现在任何可能被外人看到的地方（误传到公开仓库、发进群聊、
> 截图外发、部署日志泄露……），都算泄露。**泄露过的 Key 不能继续用，必须换。**

1. **吊销旧 Key**：去服务商后台把泄露的 Key 删除/禁用
   （智谱：控制台 → API Keys → 删除；MiniMax：账户管理 → 重置）。
2. **生成新 Key**：同一页面新建。
3. **换到新地方**：本地改 `.env.local`，线上改 Vercel 环境变量，然后重启服务 / 重新部署。
4. **清理 Git 历史**（如果误提交过）：
   ```bash
   # 方法 A：git filter-repo（推荐，需先 pip install git-filter-repo）
   git filter-repo --invert-paths --force --path .env.local
   # 方法 B：BFG（Java 工具）
   #   下载 https://rtyley.github.io/bfg-repo-cleaner/ 后：
   #   bfg --delete-files .env.local
   ```
   历史清掉后必须强推：`git push --force`。
   ⚠️ 强推后**所有协作者都要重新克隆**仓库，旧克隆里的泄露记录仍在他们本地。

## 六、发现问题如何联系

如发现本项目代码存在安全问题，请通过 GitHub Issue 或邮件联系维护者：
**[在此填写你的邮箱]**。
