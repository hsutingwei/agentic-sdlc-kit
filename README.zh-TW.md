# agentic-sdlc-kit

[English](README.md)

> **狀態：開發初期（共 10 個階段，P4 已完成）。** 最精簡的端到端流程已經可以運作：
> 任務 → worktree → 子代理 → gate → 合併 → scorecard；Claude Code 的 hooks 也能安裝，
> 並且移除後不留痕跡。詳見 [roadmap](docs/roadmap.md)。

AI coding agent 寫程式很快，但周圍的流程通常不透明：

- 負責規劃的角色看不到原始碼，只能審查它無法驗證的說法。
- 平行開發的工作到合併時才發現互相衝突。
- 沒有人能說清楚團隊是不是真的變快了。

**agentic-sdlc-kit** 讓 agent 驅動的開發做到三件事：

- **可治理**：有規則、權限，以及依風險分級的驗證關卡。
- **可驗證**：agent 的每一項說法，都會拿 diff 和同一個 commit 的 gate 結果來核對。
- **可量測**：所有紀錄只追加不改寫，每個數字都標明資料品質。

第一個支援的工具是 Claude Code，核心契約不綁定任何工具。

## 快速開始

需要 Node.js 22 以上和 git，沒有任何套件要安裝。

```sh
git clone <this repository>
cd agentic-sdlc-kit
npm test
```

想在一個用完即丟的示範專案上試跑整個流程，請照 [docs/demo.md](docs/demo.md)：

```sh
node tools/demo-setup.mjs ~/work/demo-api
cd ~/work/demo-api
node <kit>/bin/asdk.mjs task start DEMO-001 --type feature --risk low --estimate 6
node <kit>/bin/asdk.mjs wt new DEMO-001 --slug due-date
```

### 記錄你自己的 Claude Code session

```sh
node <kit>/bin/asdk.mjs project add demo-api ~/work/demo-api
node <kit>/bin/asdk.mjs hooks install     # 先備份，再修改 ~/.claude/settings.json
node <kit>/bin/asdk.mjs health            # 檢查設定，並實際執行一次 hook 計時
node <kit>/bin/asdk.mjs usage --task DEMO-001   # 依模型和子代理類型列出 token 用量
node <kit>/bin/asdk.mjs quota status      # 目前方案和最新的額度快照
node <kit>/bin/asdk.mjs disable           # 暫停紀錄；enable 恢復
node <kit>/bin/asdk.mjs hooks uninstall   # 還原成原本的位元組
```

只記錄中繼資料（事件名稱、工具名稱、大小、id），不記錄 prompt 內文、檔案內容或路徑。
資料存在 `~/.agentic-metrics/`。

## 模組

| 模組 | 用途 | 階段 |
|---|---|---|
| [`core/`](core/) | 所有模組共用的契約（任務、任務簡報、agent 報告、gate 結果、事件、token 用量），以及不依賴第三方套件的驗證器 | P0 ✅ |
| [`collector/`](collector/) | 記錄每個任務從開始到驗收的過程：hook 事件、任務生命週期、token 用量、報表、push 檢查 | P1–P5 ✅ |
| [`governance/`](governance/) | agent 指令範本、權限範例、依風險分級的關卡（G1/G2/G3） | P6 |
| [`orchestration/`](orchestration/) | 指揮官流程、依模型等級派工給子代理、平行開發用的 worktree 池 | P1、P7 |
| [`skill-regression/`](skill-regression/) | 用植入缺陷的案例，對 reviewer agent 和 skill 做回歸測試 | P8 |
| [`adapters/claude-code/`](adapters/claude-code/) | Claude Code 專屬的部分：hooks、transcript 收集、agent 定義 | P1 起 |
| [`examples/demo-api/`](examples/demo-api/) | 一個很小的待辦事項 REST API，讓 gate 和 reviewer 有東西可以套用 | P6 |

## 範例報表

取自 [examples/sample-report](examples/sample-report/)，是 `tools/make-sample.mjs` 用**虛構**資料、
透過本工具自己的報表程式產生的（12 列中列出 5 列）：

> **3.31×** over 9 Complete task(s): 30.1 h of quality-weighted estimated work (7 accepted) for 9.09 human hours. Rejected and abandoned tasks count their hours and earn nothing.

| Task | Project | Outcome | Lead (h) | AI (h) | Human (h) | Waiting on human (h) | Estimate (h) | Efficiency | Checks | First pass | Escalations | Output tokens | Data quality |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| DEMO-001 | demo-api | accepted | 4 | 1.17 | 0.92 | – | 6 | 6.52 × 0.6 = 3.91 | 3 | no | 0 | 3,711 | Complete |
| DEMO-003 | demo-web | accepted | 6 | 2.17 | 1.92 | – | 8 | 4.17 × 0.8 = 3.33 | 4 | no | 1 | 11,645 | Complete |
| DEMO-007 | demo-web | rejected | 3.33 | 1.33 | 1.08 | – | 3 | 0 | 1 | yes | 0 | 9,078 | Complete |
| DEMO-009 | demo-web | accepted | 1 | 0.25 | 0.25 | – | 1 | 4 | 2 | yes | 0 | 0 | Partial |
| DEMO-011 | demo-web | deferred | 2 | 0.83 | 0.33 | – | 5 | – | 0 | – | 0 | 9,606 | Missing |

每一列都標示資料品質；只有 `Complete` 的列會計入總效率。
定義與限制見 [docs/metrics.md](docs/metrics.md)。

## 設計原則

- **不使用第三方執行期套件。** 只用 Node 內建模組，測試用 `node:test`。
- **紀錄只追加。** 修正是新增一筆紀錄，不改寫歷史。
- **只記中繼資料，不記內容。** 不儲存 prompt 內文或檔案內容。
- **說法要驗證，不能直接採信。** agent 的報告會拿 git 和 gate 結果來核對。
- **數字要誠實。** 每一列指標都標示 `Complete`、`Partial` 或 `Missing`，並附上原因。

## 安全地參與開發

commit 會比對一份放在 **repo 以外** 的私人關鍵字清單
（`npm run hooks:install` 安裝的是這個 git hook，和 `asdk hooks install` 無關）：

```sh
npm run hooks:install
# 接著建立 ~/.config/agentic-sdlc-kit/denylist.txt
```

一行一條規則，會比對檔案內容和檔名，不分大小寫：

```text
# 註解要獨立一行。
# 擋下：一般關鍵字，以及 JavaScript 正規表示式。
acme-corp
re:\bEMP[0-9]{6}\b
# 只警告：顯示提醒，但允許 commit。
warn:widget-flux
warn:re:\bpdr\b
```

命中時只顯示檔案、行號和規則所在的行號，不會印出比對到的文字。
用 `AGENTIC_SDLC_DENYLIST` 可以指定其他檔案；設成 `AGENTIC_SDLC_DENYLIST=none` 則代表明確跳過檢查。
CI 也會用 gitleaks 掃描完整的 git 歷史。

## 限制

_待補（P9）。_

## 授權

[MIT](LICENSE)
