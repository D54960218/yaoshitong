# 发布前检查清单（RELEASE CHECKLIST）

> 用法：从上到下逐项确认，全部打勾后再上传到 GitHub。
> 每条后面的命令在项目根目录执行（Windows 可用 Git Bash 或 PowerShell）。

## 一、确认包里没有任何真实密钥

- [ ] **1. 关键字全局搜索**：下面命令的输出应该只有"模板占位符"，不能有像 `sk-...`、
      一长串随机字符这样的真实 Key。
      ```bash
      grep -rInE "(api[_-]?key|secret|token|password|Bearer |sk-|AKIA|AIza)" . \
        --exclude-dir=node_modules --exclude-dir=.next --exclude=package-lock.json
      ```
- [ ] **2. 高熵字符串扫描**（建议装 gitleaks）：`gitleaks detect --source . --verbose`
      结果应为 `no leaks found`。
- [ ] **3. 确认没有私密配置文件**：`ls -a | grep env`（或 `dir /a .env*`）
      只能看到 `.env.example` 和 `.env.local.example` 两个模板，
      **绝不能**出现 `.env.local`、`.env.production`。
- [ ] **4. 示例图片无隐私信息**：`public/samples/` 里的照片确认是自己有权使用的
      （当前 3 张为维基共享资源 CC BY-SA 4.0 授权，出处见夹内 README.txt），
      换自己的照片时注意别拍到病历、处方、快递单等隐私内容。

## 二、确认密钥只走环境变量

- [ ] **5. 不填 Key 能正常启动**：删掉（或改名备份）`.env.local`，`npm run dev` 能起来，
      页面点识别会提示"服务器还没配置 API Key"——这说明代码里没有藏 Key。
- [ ] **6. 填了 Key 功能正常**：按 `填写密钥.bat` 填好，识别 + 语音播报都成功。

## 三、确认 Git 不会把密钥带进去

- [ ] **7. `.gitignore` 生效测试**：填好 `.env.local` 后运行 `git status`，
      文件列表里**看不到** `.env.local`（被忽略了才算对）。
- [ ] **8. 钩子已启用**（维护者）：装过 gitleaks 后执行过
      `git config core.hooksPath .githooks`，并试提交一次确认钩子会跑。

## 四、首次推送前的仓库设置

- [ ] **9. GitHub 安全开关**：仓库 **Settings → Code security and analysis** 里确认
      Secret scanning 已开、Push protection 已开。
- [ ] **10. 首次推送用私有仓库过渡（可选但推荐）**：先建 **Private** 仓库推上去，
      确认 GitHub 没有给任何安全告警，再转 Public。
- [ ] **11. Vercel 环境变量已配**（如部署线上）：Settings → Environment Variables 里
      加好 `ZHIPU_API_KEY`、`MINIMAX_API_KEY`、`YIYUAN_APP_KEY`（按需 `MINIMAX_GROUP_ID`），
      线上点一遍识别和播报。

## 五、仅当"以前误传过带密钥的版本"才需要做

- [ ] **12. 吊销旧 Key 并生成新 Key**（去智谱 / MiniMax 后台操作）。
- [ ] **13. 清理 Git 历史**：`git filter-repo --invert-paths --path .env.local`
      （用法详见 SECURITY.md 第五节）。
- [ ] **14. 强推并通知**：`git push --force` 后，所有拿过这个仓库的人都要**删除本地旧克隆、
      重新克隆**。

---

全部打勾 ✅ 后就可以放心发布。发布后若收到 GitHub 的密钥告警邮件，回到第五节处理。
