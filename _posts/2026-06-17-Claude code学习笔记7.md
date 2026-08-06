---
layout: post
title: Claude code学习7 权限模式
date: 2026-06-17 22:21:00 +0800
categories: [agent]
tags: [agent, claude-code, permissions]
---

## 权限模式

```ts
// Apply DeepImmutable to the imported type
export type ToolPermissionContext = DeepImmutable<{
  mode: PermissionMode;
  additionalWorkingDirectories: Map<string, AdditionalWorkingDirectory>;
  alwaysAllowRules: ToolPermissionRulesBySource;
  alwaysDenyRules: ToolPermissionRulesBySource;
  alwaysAskRules: ToolPermissionRulesBySource;
  isBypassPermissionsModeAvailable: boolean;
  isAutoModeAvailable?: boolean;
  strippedDangerousRules?: ToolPermissionRulesBySource;
  /** When true, permission prompts are auto-denied (e.g., background agents that can't show UI) */
  shouldAvoidPermissionPrompts?: boolean;
  /** When true, automated checks (classifier, hooks) are awaited before showing the permission dialog (coordinator workers) */
  awaitAutomatedChecksBeforeDialog?: boolean;
  /** Stores the permission mode before model-initiated plan mode entry, so it can be restored on exit */
  prePlanMode?: PermissionMode;
}>;
```

### 权限模式的类型层次

```ts
export const EXTERNAL_PERMISSION_MODES = ["acceptEdits", "bypassPermissions", "default", "dontAsk", "plan"] as const;

export type ExternalPermissionMode = (typeof EXTERNAL_PERMISSION_MODES)[number];

export type InternalPermissionMode = ExternalPermissionMode | "auto" | "bubble";
export type PermissionMode = InternalPermissionMode;
```

分层设计：

- **ExternalPermissionMode**（5 种）：用户可通过设置或命令行指定
- **InternalPermissionMode**（+2 种）：系统运行时自动切换，用户不能直接设置
  - `auto`：自动模式（AFK/无人值守），仅在 `TRANSCRIPT_CLASSIFIER` feature flag 启用时存在
  - `bubble`：冒泡模式，子 agent 把权限请求冒泡给父 agent 决策

### 七种权限模式详解

#### default —— 默认模式

默认模式就是不做啥特殊处理 这里从这个函数可以看出default模式具体做啥的

```ts
async function hasPermissionsToUseToolInner(tool: Tool, input: { [key: string]: unknown }, context: ToolUseContext): Promise<PermissionDecision> {
  if (context.abortController.signal.aborted) {
    throw new AbortError();
  }

  let appState = context.getAppState();

  // 1. Check if the tool is denied
  // 1a. Entire tool is denied
  const denyRule = getDenyRuleForTool(appState.toolPermissionContext, tool);
  if (denyRule) {
    return {
      behavior: "deny",
      decisionReason: {
        type: "rule",
        rule: denyRule,
      },
      message: `Permission to use ${tool.name} has been denied.`,
    };
  }

  // 1b. Check if the entire tool should always ask for permission
  const askRule = getAskRuleForTool(appState.toolPermissionContext, tool);
  if (askRule) {
    // When autoAllowBashIfSandboxed is on, sandboxed commands skip the ask rule and
    // auto-allow via Bash's checkPermissions. Commands that won't be sandboxed (excluded
    // commands, dangerouslyDisableSandbox) still need to respect the ask rule.
    const canSandboxAutoAllow =
      tool.name === BASH_TOOL_NAME &&
      SandboxManager.isSandboxingEnabled() &&
      SandboxManager.isAutoAllowBashIfSandboxedEnabled() &&
      shouldUseSandbox(input);

    if (!canSandboxAutoAllow) {
      return {
        behavior: "ask",
        decisionReason: {
          type: "rule",
          rule: askRule,
        },
        message: createPermissionRequestMessage(tool.name),
      };
    }
    // Fall through to let Bash's checkPermissions handle command-specific rules
  }

  // 1c. Ask the tool implementation for a permission result
  // Overridden unless tool input schema is not valid
  let toolPermissionResult: PermissionResult = {
    behavior: "passthrough",
    message: createPermissionRequestMessage(tool.name),
  };
  try {
    const parsedInput = tool.inputSchema.parse(input);
    toolPermissionResult = await tool.checkPermissions(parsedInput, context);
  } catch (e) {
    // Rethrow abort errors so they propagate properly
    if (e instanceof AbortError || e instanceof APIUserAbortError) {
      throw e;
    }
    logError(e);
  }

  // 1d. Tool implementation denied permission
  if (toolPermissionResult?.behavior === "deny") {
    return toolPermissionResult;
  }

  // 1e. Tool requires user interaction even in bypass mode
  if (tool.requiresUserInteraction?.() && toolPermissionResult?.behavior === "ask") {
    return toolPermissionResult;
  }

  // 1f. Content-specific ask rules from tool.checkPermissions take precedence
  // over bypassPermissions mode. When a user explicitly configures a
  // content-specific ask rule (e.g. Bash(npm publish:*)), the tool's
  // checkPermissions returns {behavior:'ask', decisionReason:{type:'rule',
  // rule:{ruleBehavior:'ask'}}}. This must be respected even in bypass mode,
  // just as deny rules are respected at step 1d.
  if (
    toolPermissionResult?.behavior === "ask" &&
    toolPermissionResult.decisionReason?.type === "rule" &&
    toolPermissionResult.decisionReason.rule.ruleBehavior === "ask"
  ) {
    return toolPermissionResult;
  }

  // 1g. Safety checks (e.g. .git/, .claude/, .vscode/, shell configs) are
  // bypass-immune — they must prompt even in bypassPermissions mode.
  // checkPathSafetyForAutoEdit returns {type:'safetyCheck'} for these paths.
  if (toolPermissionResult?.behavior === "ask" && toolPermissionResult.decisionReason?.type === "safetyCheck") {
    return toolPermissionResult;
  }

  // 2a. Check if mode allows the tool to run
  // IMPORTANT: Call getAppState() to get the latest value
  appState = context.getAppState();
  // Check if permissions should be bypassed:
  // - Direct bypassPermissions mode
  // - Plan mode when the user originally started with bypass mode (isBypassPermissionsModeAvailable)
  const shouldBypassPermissions =
    appState.toolPermissionContext.mode === "bypassPermissions" ||
    (appState.toolPermissionContext.mode === "plan" && appState.toolPermissionContext.isBypassPermissionsModeAvailable);
  if (shouldBypassPermissions) {
    return {
      behavior: "allow",
      updatedInput: getUpdatedInputOrFallback(toolPermissionResult, input),
      decisionReason: {
        type: "mode",
        mode: appState.toolPermissionContext.mode,
      },
    };
  }

  // 2b. Entire tool is allowed
  const alwaysAllowedRule = toolAlwaysAllowedRule(appState.toolPermissionContext, tool);
  if (alwaysAllowedRule) {
    return {
      behavior: "allow",
      updatedInput: getUpdatedInputOrFallback(toolPermissionResult, input),
      decisionReason: {
        type: "rule",
        rule: alwaysAllowedRule,
      },
    };
  }

  // 3. Convert "passthrough" to "ask"
  const result: PermissionDecision =
    toolPermissionResult.behavior === "passthrough"
      ? {
          ...toolPermissionResult,
          behavior: "ask" as const,
          message: createPermissionRequestMessage(tool.name, toolPermissionResult.decisionReason),
        }
      : toolPermissionResult;

  if (result.behavior === "ask" && result.suggestions) {
    logForDebugging(`Permission suggestions for ${tool.name}: ${jsonStringify(result.suggestions, null, 2)}`);
  }

  return result;
}
```

主要他做的事情就是查看规则,对应规则有不同处理模式

```
const PERMISSION_RULE_SOURCES = [
  // 设置文件来源（5 种）
  'userSettings',      // ~/.claude/settings.json（用户全局设置）
  'projectSettings',   // .claude/settings.json（项目级，git 提交）
  'localSettings',     // .claude/settings.local.json（本地，gitignore）
  'flagSettings',      // --settings CLI flag 指定的设置文件
  'policySettings',    // managed-settings.json 或远程 API 下发的策略

  // 运行时来源（2 种）
  'cliArg',            // 命令行参数
  'command',           // 命令执行时动态设置
  'session',           // 会话中用户交互设置（如弹框里选 "Always allow"）
] as const
```

1a. Entire tool is denied

```ts
{
      behavior: 'deny',
      decisionReason: {
        type: 'rule',
        rule: denyRule,
      },
      message: `Permission to use ${tool.name} has been denied.`,
    }
```

如果是被禁止的工具就会返回被禁止，如果是在沙盒环境下没啥风险的情况下会自动放行，在不是沙盒模式的情况下进行询问
1b. Check if the entire tool should always ask for permission

```ts
const askRule = getAskRuleForTool(appState.toolPermissionContext, tool);
if (askRule) {
  // When autoAllowBashIfSandboxed is on, sandboxed commands skip the ask rule and
  // auto-allow via Bash's checkPermissions. Commands that won't be sandboxed (excluded
  // commands, dangerouslyDisableSandbox) still need to respect the ask rule.
  const canSandboxAutoAllow =
    tool.name === BASH_TOOL_NAME &&
    SandboxManager.isSandboxingEnabled() &&
    SandboxManager.isAutoAllowBashIfSandboxedEnabled() &&
    shouldUseSandbox(input);

  if (!canSandboxAutoAllow) {
    return {
      behavior: "ask",
      decisionReason: {
        type: "rule",
        rule: askRule,
      },
      message: createPermissionRequestMessage(tool.name),
    };
  }
  // Fall through to let Bash's checkPermissions handle command-specific rules
}
```

1c. Ask the tool implementation for a permission result Overridden unless tool input schema is not valid
如果这个工具是否执行有异议，那就交给工具自己判断是否可以执行

```ts
// 1c. Ask the tool implementation for a permission result
// Overridden unless tool input schema is not valid
let toolPermissionResult: PermissionResult = {
  behavior: "passthrough",
  message: createPermissionRequestMessage(tool.name),
};
try {
  const parsedInput = tool.inputSchema.parse(input);
  toolPermissionResult = await tool.checkPermissions(parsedInput, context);
} catch (e) {
  // Rethrow abort errors so they propagate properly
  if (e instanceof AbortError || e instanceof APIUserAbortError) {
    throw e;
  }
  logError(e);
}
```

这里以读文件来举例，这是读文件的tool里面关于权限的函数

```ts
async checkPermissions(input, context): Promise<PermissionDecision> {
  const appState = context.getAppState()
  return checkReadPermissionForTool(
    FileReadTool,
    input,
    appState.toolPermissionContext,
  )
},
```

可以看到它返回了checkReadPermissionForTool

```ts
export function checkReadPermissionForTool(
  tool: Tool,
  input: { [key: string]: unknown },
  toolPermissionContext: ToolPermissionContext
): PermissionDecision;
```

他会返回对应的权限结果
在Claude code中可以看得tool加了许多许多的权限以及约束，并不像我们平时写的那么简单 在工具的执行方面，居然还有关于工具本身来判断段读写的逻辑
1d. Tool implementation denied permission
如果工具返回了被拒绝的权限，直接返回

```ts
if (toolPermissionResult?.behavior === "deny") {
  return toolPermissionResult;
}
```

1e. Tool requires user interaction even in bypass mode
如果工具返回需要用户交互即使是by pass模式，也要返回

```ts
if (tool.requiresUserInteraction?.() && toolPermissionResult?.behavior === "ask") {
  return toolPermissionResult;
}
```

1f. Content-specific ask rules from tool.checkPermissions take precedence over bypassPermissions mode. When a user explicitly configures a content-specific ask rule (e.g. Bash(npm publish:*)), the tool's checkPermissions returns {behavior:'ask', decisionReason:{type:'rule', rule:{ruleBehavior:'ask'}}}. This must be respected even in bypass mode, just as deny rules are respected at step 1d.
如果一个命令用户都说需要询问了，那这就是最高级别的指示，即使是bypass模式也需要问

```ts
if (
  toolPermissionResult?.behavior === "ask" &&
  toolPermissionResult.decisionReason?.type === "rule" &&
  toolPermissionResult.decisionReason.rule.ruleBehavior === "ask"
) {
  return toolPermissionResult;
}
```

1g. Safety checks (e.g. .git/, .claude/, .vscode/, shell configs) are bypass-immune — they must prompt even in bypassPermissions mode. checkPathSafetyForAutoEdit returns {type:'safetyCheck'} for these paths.

```ts
if (toolPermissionResult?.behavior === "ask" && toolPermissionResult.decisionReason?.type === "safetyCheck") {
  return toolPermissionResult;
}
```

2a. Check if mode allows the tool to run IMPORTANT: Call getAppState() to get the latest value

```ts
// 2a. Check if mode allows the tool to run
// IMPORTANT: Call getAppState() to get the latest value
appState = context.getAppState();
// Check if permissions should be bypassed:
// - Direct bypassPermissions mode
// - Plan mode when the user originally started with bypass mode (isBypassPermissionsModeAvailable)
const shouldBypassPermissions =
  appState.toolPermissionContext.mode === "bypassPermissions" ||
  (appState.toolPermissionContext.mode === "plan" && appState.toolPermissionContext.isBypassPermissionsModeAvailable);
if (shouldBypassPermissions) {
  return {
    behavior: "allow",
    updatedInput: getUpdatedInputOrFallback(toolPermissionResult, input),
    decisionReason: {
      type: "mode",
      mode: appState.toolPermissionContext.mode,
    },
  };
}
```

2b. Entire tool is allowed
如果工具匹配了 allow 规则 → 直接放行。

和 1b（ask 规则）的关系：1b 在前面已经检查过 deny 和 ask 规则了，能走到 2b 说明没有被 deny 或 ask 规则拦截。

```ts
// 2b. Entire tool is allowed
const alwaysAllowedRule = toolAlwaysAllowedRule(appState.toolPermissionContext, tool);
if (alwaysAllowedRule) {
  return {
    behavior: "allow",
    updatedInput: getUpdatedInputOrFallback(toolPermissionResult, input),
    decisionReason: {
      type: "rule",
      rule: alwaysAllowedRule,
    },
  };
}
```

3 Convert "passthrough" to "ask"
询问是否应该通过

```ts
// 3. Convert "passthrough" to "ask"
const result: PermissionDecision =
  toolPermissionResult.behavior === "passthrough"
    ? {
        ...toolPermissionResult,
        behavior: "ask" as const,
        message: createPermissionRequestMessage(tool.name, toolPermissionResult.decisionReason),
      }
    : toolPermissionResult;

if (result.behavior === "ask" && result.suggestions) {
  logForDebugging(`Permission suggestions for ${tool.name}: ${jsonStringify(result.suggestions, null, 2)}`);
}
```

1a. deny 规则 → 拒绝（无视模式）
1b. ask 规则 → 询问（无视模式）
1c. tool.checkPermissions() → 工具自己判断
1d. 工具 deny → 拒绝（无视模式）
1e. 需要交互 → 询问（无视模式）
1f. 用户 ask 规则 → 询问（无视模式）
1g. 敏感路径 → 询问（无视模式）
─── 以上是硬性规则，bypass 也绕不过 ───
2a. bypass 模式 → 放行
2b. allow 规则 → 放行
─── 以下是兜底 ───
passthrough → ask（弹确认框）

### basictool

内置工具 A-Z 固定排序：Bash、FileRead、FileEdit、Grep 等内置工具形成稳定工具前缀。顺序不随会话、项目或用户偏好波动。
为什么要进行A-Z的排序呢，当然也是照顾当kv cache，需要形成稳定的前缀，才能避免缓存的频繁更改

```ts
/**
 * Get the complete exhaustive list of all tools that could be available
 * in the current environment (respecting process.env flags).
 * This is the source of truth for ALL tools.
 */
/**
 * NOTE: This MUST stay in sync with https://console.statsig.com/4aF3Ewatb6xPVpCwxb5nA3/dynamic_configs/claude_code_global_system_caching, in order to cache the system prompt across users.
 */
export function getAllBaseTools(): Tools {
  return [
    AgentTool,
    TaskOutputTool,
    BashTool,
    // Ant-native builds have bfs/ugrep embedded in the bun binary (same ARGV0
    // trick as ripgrep). When available, find/grep in Claude's shell are aliased
    // to these fast tools, so the dedicated Glob/Grep tools are unnecessary.
    ...(hasEmbeddedSearchTools() ? [] : [GlobTool, GrepTool]),
    ExitPlanModeV2Tool,
    FileReadTool,
    FileEditTool,
    FileWriteTool,
    NotebookEditTool,
    WebFetchTool,
    TodoWriteTool,
    WebSearchTool,
    TaskStopTool,
    AskUserQuestionTool,
    SkillTool,
    EnterPlanModeTool,
    ...(process.env.USER_TYPE === "ant" ? [ConfigTool] : []),
    ...(process.env.USER_TYPE === "ant" ? [TungstenTool] : []),
    ...(SuggestBackgroundPRTool ? [SuggestBackgroundPRTool] : []),
    ...(WebBrowserTool ? [WebBrowserTool] : []),
    ...(isTodoV2Enabled() ? [TaskCreateTool, TaskGetTool, TaskUpdateTool, TaskListTool] : []),
    ...(OverflowTestTool ? [OverflowTestTool] : []),
    ...(CtxInspectTool ? [CtxInspectTool] : []),
    ...(TerminalCaptureTool ? [TerminalCaptureTool] : []),
    ...(isEnvTruthy(process.env.ENABLE_LSP_TOOL) ? [LSPTool] : []),
    ...(isWorktreeModeEnabled() ? [EnterWorktreeTool, ExitWorktreeTool] : []),
    getSendMessageTool(),
    ...(ListPeersTool ? [ListPeersTool] : []),
    ...(isAgentSwarmsEnabled() ? [getTeamCreateTool(), getTeamDeleteTool()] : []),
    ...(VerifyPlanExecutionTool ? [VerifyPlanExecutionTool] : []),
    ...(process.env.USER_TYPE === "ant" && REPLTool ? [REPLTool] : []),
    ...(WorkflowTool ? [WorkflowTool] : []),
    ...(SleepTool ? [SleepTool] : []),
    ...cronTools,
    ...(RemoteTriggerTool ? [RemoteTriggerTool] : []),
    ...(MonitorTool ? [MonitorTool] : []),
    BriefTool,
    ...(SendUserFileTool ? [SendUserFileTool] : []),
    ...(PushNotificationTool ? [PushNotificationTool] : []),
    ...(SubscribePRTool ? [SubscribePRTool] : []),
    ...(getPowerShellTool() ? [getPowerShellTool()] : []),
    ...(SnipTool ? [SnipTool] : []),
    ...(process.env.NODE_ENV === "test" ? [TestingPermissionTool] : []),
    ListMcpResourcesTool,
    ReadMcpResourceTool,
    // Include ToolSearchTool when tool search might be enabled (optimistic check)
    // The actual decision to defer tools happens at request time in claude.ts
    ...(isToolSearchEnabledOptimistic() ? [ToolSearchTool] : []),
  ];
}
```

内置工具按 A-Z 排序：
Agent → AskUserQuestion → Bash → Brief → CronCreate → CronDelete →
CronList → Edit → EnterPlanMode → EnterWorktree → ExitPlanMode →
ExitWorktree → Glob → Grep → LSP → ListMcpResources → Monitor →
NotebookEdit → PowerShell → PushNotification → Read → ReadMcpResource →
SendMessage → Skill → Sleep → TaskCreate → TaskGet → TaskList →
TaskOutput → TaskStop → TaskUpdate → TodoWrite → WebFetch → WebSearch →
Write → ...

MCP 工具按 A-Z 排序（追加在后）：
mcp__db__query → mcp__db__write → mcp__slack__msg → ...

注释里的关键解释

// Sort each partition for prompt-cache stability, keeping built-ins as a
// contiguous prefix. The server's claude_code_system_cache_policy places a
// global cache breakpoint after the last prefix-matched built-in tool; a flat
// sort would interleave MCP tools into built-ins and invalidate all downstream
// cache keys whenever an MCP tool sorts between existing built-ins.

翻译：

▎ 每个分区独立排序以保持 prompt cache 稳定性，内置工具保持为连续前缀。
▎ 服务器的缓存策略在最后一个前缀匹配的内置工具之后放置全局缓存断点；
▎ 如果平铺排序，MCP 工具会穿插在内置工具之间，每当一个 MCP 工具排在
▎ 现有内置工具之间时，所有下游的 cache key 都会失效。
也印证了刚刚我说的

为什么 localeCompare 而不是硬编码顺序

const byName = (a: Tool, b: Tool) => a.name.localeCompare(b.name)

localeCompare 是确定性的——同样的工具名永远产生同样的顺序。不需要维护一个硬编码的顺序列表，新增工具时只要名字确定了，排序就自动确定。

而且 localeCompare 在不同平台上结果一致（对 ASCII 字符来说就是简单的字母顺序），保证了 cache key 的稳定性。

### Tool接口

#### 1. 身份标识

```ts
name: string                    // 唯一标识符，如 "Read", "Bash", "Edit"
aliases?: string[]              // 重命名后的旧名字（向后兼容）
searchHint?: string             // ToolSearch 的关键词（3-10 词）
isMcp?: boolean                 // 是否来自 MCP 服务器
isLsp?: boolean                 // 是否 LSP 工具
mcpInfo?: { serverName, toolName }  // MCP 工具的来源信息
```

searchHint 的例子：NotebookEdit 工具的名字里没有 "jupyter"，所以 searchHint: 'jupyter notebook cell'，让模型能通过关键词找到它，因为你的工具名字不一定跟用户描述的一样或者相似，如果直接用description我觉得不是不行，但是如果有searchHint，那么llm就可以通过关键词搜索到它，肯定是更方便的

---

2. Schema 定义

```ts
inputSchema: Input              // Zod schema，定义输入参数的类型和约束
inputJSONSchema?: ToolInputJSONSchema  // MCP 工具的原生 JSON Schema（不经过 Zod 转换）
outputSchema?: z.ZodType        // 输出 schema（可选，目前大部分工具没用）

inputSchema 是用 Zod 定义的：
// FileReadTool 的 inputSchema 例子
const fileReadSchema = z.object({
  file_path: z.string().describe("The absolute path to the file to read"),
  offset: z.number().optional().describe("Line number to start reading from"),
  limit: z.number().optional().describe("Number of lines to read"),
})
```

这个 schema 会被 toolToAPISchema() 转换成 JSON Schema 格式发送给 API。

---

3. 执行

```ts
call(args, context, canUseTool, parentMessage, onProgress)
  → Promise<ToolResult<Output>>
```

一个异步的执行，毕竟绝大部分的工具可能都不是一瞬间完成的

---

4. 权限与安全

```ts
isReadOnly(input): boolean          // 是否只读操作
isDestructive?(input): boolean      // 是否不可逆（delete/overwrite/send）
checkPermissions(input, context)    // 工具特定的权限检查
  → Promise<PermissionResult>
requiresUserInteraction?(): boolean // 是否必须用户交互
validateInput?(input, context)      // 输入校验（在 checkPermissions 之前）
  → Promise<ValidationResult>
getPath?(input): string             // 获取文件路径（用于路径安全检查）
preparePermissionMatcher?(input)    // 准备 hook 规则匹配器
  → Promise<(pattern: string) => boolean>
```

isDestructive是值得学习的一个点，对于像是提交之类的操作，会产生可能不可逆后果的函数，确实是需要对应提醒的
执行顺序：validateInput → checkPermissions → call

---

5. 并发与中断

```ts
isConcurrencySafe(input): boolean   // 是否可以和其他工具并行执行
interruptBehavior?(): 'cancel' | 'block'  // 用户发新消息时怎么办
```

isConcurrencySafe = true → 多个实例可以同时跑
isConcurrencySafe = false → 必须串行执行（默认）

interruptBehavior = 'cancel' → 停止工具，丢弃结果
interruptBehavior = 'block' → 继续跑，新消息排队等待（默认）

---

6. 搜索与展示分类

```ts
isSearchOrReadCommand?(input): { isSearch, isRead, isList? }
isOpenWorld?(input): boolean
```

用于 UI 折叠——搜索/读取操作在非 verbose 模式下会被折叠显示：

isSearch: true → Grep, Glob, find（搜索操作）
isRead: true → Read, cat, head（读取操作）
isList: true → ls, tree（目录列表）

---

7. 缓存与加载控制

```ts
readonly strict?: boolean       // API 严格模式（更严格遵循 schema）
readonly shouldDefer?: boolean  // 延迟加载（需要 ToolSearch 才能用）
readonly alwaysLoad?: boolean   // 始终加载（不被 defer）
```

shouldDefer = true → 工具定义不发给 API，模型用 ToolSearch 才能发现
alwaysLoad = true → 即使 ToolSearch 启用，也始终出现在 API 请求中

---

8. UI 渲染（React 组件）

```ts
// 输入侧渲染
renderToolUseMessage(input, options)        → ReactNode  // 工具调用的显示
renderToolUseTag?(input)                    → ReactNode  // 调用后的标签（超时、模型等）
renderToolUseQueuedMessage?()               → ReactNode  // 排队中的显示

// 进度渲染
ontent, progress, options) → ReactNode  // 结果的显示
renderToolUseRejectedMessage?(input, options) → ReactNode  // 被拒绝时的显示
renderToolUseErrorMessage?(result, options)   → ReactNode  // 出错时的显示

// 分组渲染
renderGroupedToolUse?(toolUses, options)      → ReactNode | null  // 多个并行调用的分组显示

// 辅助
userFacingName(input): string                // 显示给用户的名字
userFacingNameBackgroundColor?(input)        // 名字的背景色
getToolUseSummary?(input): string | null     // 紧凑视图的摘要
getActivityDescription?(input): string | null // spinner 的描述文字
isResultTruncated?(output): boolean          // 结果是否被截断（点击展开）
isTransparentWrapper?(): boolean             // 是否透明包装器（如 REPL）
```

---

9. 序列化与索引

```ts
// 模型侧序列化
mapToolResultToToolResultBlockParam(content, toolUseID)
  → ToolResultBlockParam  // 结果 → API 格式

tput): string  // 提取纯文本用于转录搜索

// 输入处理
backfillObservableInput?(input): void    // 在 observer 看到之前填充派生字段
inputsEquivalent?(a, b): boolean         // 两个输入是否等价（用于去重）

// Classifier
toAutoClassifierInput(input): unknown    // auto 模式 classifier 的输入
```

---

10. 动态描述

```ts
description(input, options): Promise<string>
```

工具描述可以是动态的——根据输入、权限上下文、可用工具列表生成不同的描述。
这里对的动态主要是指的mcp以及agenttool一类的工具，因为他们的状态变化大，所以每次都需要作重新的计算
但是对于像读写这类静态的工具而言，一般是直接进缓存的
这里的description跟在md文件里面看到对于工具描述的description不是一个东西，对于传入api的描述而言

```ts
base = {
  name: tool.name,
  description: await tool.prompt({
    getToolPermissionContext: options.getToolPermissionContext,
    tools: options.tools,
    agents: options.agents,
    allowedAgentTypes: options.allowedAgentTypes,
  }),
  input_schema,
};
```

可以看到传入的是工具的prompt，这里的description主要是面对的是用户，给人看的
---

1.  Prompt 生成

```ts
  prompt(options: {
    getToolPermissionContext: () => Promise<ToolPermissionContext>
    tools: Tools
    agents: AgentDefinition[]
    allowedAgentTypes?: string[]
  }): Promise<string>
```

生成工具的指令文本——注入到系统提示中，告诉模型怎么使用这个工具。比如 BashTool 的 prompt 会说明 shell 语法、超时设置等。

---

buildTool() 如何组装

```ts
export function buildTool<D>(def: D): BuiltTool<D> {
  return {
    ...TOOL_DEFAULTS, // 安全默认值
    userFacingName: () => def.name, // 默认用 name
    ...def, // 工具自己的定义覆盖默认值
  };
}
```

工具只需要实现自己关心的方法，其他的用默认值：

- 不实现 isReadOnly → 默认 false（假设会写）
- 不实现 isConcurrencySafe → 默认 false（假设不能并行）
- 不实现 checkPermissions → 默认 allow（交给通用权限系统）
