---
layout: post
title: Claude code学习6 动态prompt的组装2
date: 2026-06-17 22:21:00 +0800
categories: [agent]
tags: [agent, claude-code, prompt-engineering]
---

## 动态prompt的组装

前面的静态prompt，由于KV cache的最大利用化，把动态变化的prompt放在了最后面

```ts

    systemPromptSection('ant_model_override', () =>
      getAntModelOverrideSection(),
    ),
    systemPromptSection('env_info_simple', () =>
      computeSimpleEnvInfo(model, additionalWorkingDirectories),
    ),
    systemPromptSection('language', () =>
      getLanguageSection(settings.language),
    ),
    systemPromptSection('output_style', () =>
      getOutputStyleSection(outputStyleConfig),
    ),
    // When delta enabled, instructions are announced via persisted
    // mcp_instructions_delta attachments (attachments.ts) instead of this
    // per-turn recompute, which busts the prompt cache on late MCP connect.
    // Gate check inside compute (not selecting between section variants)
    // so a mid-session gate flip doesn't read a stale cached value.
    DANGEROUS_uncachedSystemPromptSection(
      'mcp_instructions',
      () =>
        isMcpInstructionsDeltaEnabled()
          ? null
          : getMcpInstructionsSection(mcpClients),
      'MCP servers connect/disconnect between turns',
    ),
    systemPromptSection('scratchpad', () => getScratchpadInstructions()),
    systemPromptSection('frc', () => getFunctionResultClearingSection(model)),
    systemPromptSection(
      'summarize_tool_results',
      () => SUMMARIZE_TOOL_RESULTS_SECTION,
    ),
    // Numeric length anchors — research shows ~1.2% output token reduction vs
    // qualitative "be concise". Ant-only to measure quality impact first.
    ...(process.env.USER_TYPE === 'ant'
      ? [
          systemPromptSection(
            'numeric_length_anchors',
            () =>
              'Length limits: keep text between tool calls to \u226425 words. Keep final responses to \u2264100 words unless the task requires more detail.',
          ),
        ]
      : []),
    ...(feature('TOKEN_BUDGET')
      ? [
          // Cached unconditionally — the "When the user specifies..." phrasing
          // makes it a no-op with no budget active. Was DANGEROUS_uncached
          // (toggled on getCurrentTurnTokenBudget()), busting ~20K tokens per
          // budget flip. Not moved to a tail attachment: first-response and
          // budget-continuation paths don't see attachments (#21577).
          systemPromptSection(
            'token_budget',
            () =>
              'When the user specifies a token target (e.g., "+500k", "spend 2M tokens", "use 1B tokens"), your output token count will be shown each turn. Keep working until you approach the target \u2014 plan your work to fill it productively. The target is a hard minimum, not a suggestion. If you stop early, the system will automatically continue you.',
          ),
        ]
      : []),
    ...(feature('KAIROS') || feature('KAIROS_BRIEF')
      ? [systemPromptSection('brief', () => getBriefSection())]
      : []),
  ]
```

前面讲了这两种动态的prompt 今天来看后面的种类
我发现似乎前面写的太过详细了 或者说有点没有必要 显得有些主次不分 所以这次会整的简单一点（但确实是很重要的两个part）

### ant model override

```ts
function getAntModelOverrideSection(): string | null {
  if (process.env.USER_TYPE !== "ant") return null;
  if (isUndercover()) return null;
  return getAntModelOverrideConfig()?.defaultSystemPromptSuffix || null;
}
```

这个是antropic自己内部测试时候打开的开关，跟我们没啥关系，也跟要学习的prompt没啥关系

### env info simple

这简单来说就是工作环境的简单信息 告诉llm
这个函数把当前运行环境的信息注入到系统提示中，让 Claude 知道自己在哪运行、用什么模型。
大概的输出是这样的

```ts
# Environment
You have been invoked in the following environment:
- Primary working directory: E:\your-project-folder
- Is a git repository: true
- Platform: win32
- Shell: PowerShell (use PowerShell syntax...)
- OS Version: Windows 11 Home China 10.0.26200
- You are powered by the model named Claude Opus 4. The exact model ID is claude-opus-4-8.
- Assistant knowledge cutoff is 2025-05.
- The most recent Claude model family is Claude 4.5/4.6...
- Claude Code is available as a CLI in the terminal, desktop app...
- Fast mode for Claude Code uses the same Claude Opus model...
```

可以看出操作系统，模型名，知识的日期，etc

```ts
const envItems = [
  `Primary working directory: ${cwd}`,
  isWorktree
    ? `This is a git worktree — an isolated copy of the repository. Run all commands from this directory. Do NOT \`cd\` to the original repository root.`
    : null,
  [`Is a git repository: ${isGit}`],
  additionalWorkingDirectories && additionalWorkingDirectories.length > 0 ? `Additional working directories:` : null,
  additionalWorkingDirectories && additionalWorkingDirectories.length > 0 ? additionalWorkingDirectories : null,
  `Platform: ${env.platform}`,
  getShellInfoLine(),
  `OS Version: ${unameSR}`,
  modelDescription,
  knowledgeCutoffMessage,
  process.env.USER_TYPE === "ant" && isUndercover()
    ? null
    : `The most recent Claude model family is Claude 4.5/4.6. Model IDs — Opus 4.6: '${CLAUDE_4_5_OR_4_6_MODEL_IDS.opus}', Sonnet 4.6: '${CLAUDE_4_5_OR_4_6_MODEL_IDS.sonnet}', Haiku 4.5: '${CLAUDE_4_5_OR_4_6_MODEL_IDS.haiku}'. When building AI applications, default to the latest and most capable Claude models.`,
  process.env.USER_TYPE === "ant" && isUndercover()
    ? null
    : `Claude Code is available as a CLI in the terminal, desktop app (Mac/Windows), web app (claude.ai/code), and IDE extensions (VS Code, JetBrains).`,
  process.env.USER_TYPE === "ant" && isUndercover()
    ? null
    : `Fast mode for Claude Code uses the same ${FRONTIER_MODEL_NAME} model with faster output. It does NOT switch to a different model. It can be toggled with /fast.`,
].filter((item) => item !== null);
```

告诉我们的启示就是不要一股脑给模型工具，或者全部写在description里面，如果模型都不知道自己在什么平台工作，那还得了？windows平台那里用linux里面的命令，这很明显就是不太对的

### language

顾名思义 语言

```ts
function getLanguageSection(languagePreference: string | undefined): string | null {
  if (!languagePreference) return null;

  return `# Language
Always respond in ${languagePreference}. Use ${languagePreference} for all explanations, comments, and communications with the user. Technical terms and code identifiers should remain in their original form.`;
}
```

### output style

输出风格

```ts
function getOutputStyleSection(outputStyleConfig: OutputStyleConfig | null): string | null {
  if (outputStyleConfig === null) return null;

  return `# Output Style: ${outputStyleConfig.name}
${outputStyleConfig.prompt}`;
}
```

三种内置风格

1. default — 默认风格

[DEFAULT_OUTPUT_STYLE_NAME]: null, // 返回 null，不注入额外指令

就是标准的 Claude Code 行为——简洁、直接、专注任务。getOutputStyleSection 收到 null 直接返回，不往系统提示里加任何东西。

2. Explanatory — 解释型

{
name: 'Explanatory',
description: 'Claude explains its implementation choices and codebase patterns',
keepCodingInstructions: true,
prompt: `...`
}

Claude 在写代码的同时附带教育性解释。核心机制是 Insights 块：

`★ Insight ─────────────────────────────────────`
[2-3 个关键教育点]
`─────────────────────────────────────────────────`

特点：

- 在写代码前后插入解释
- 聚焦于这个代码库特有的洞察，不是通用编程概念
- 可以超过通常的长度限制
- keepCodingInstructions: true → 保留编码指令（不覆盖默认行为）

3. Learning — 学习型

{
name: 'Learning',
description: 'Claude pauses and asks you to write small pieces of code for hands-on practice',
keepCodingInstructions: true,
prompt: `...`
}

最复杂的风格。Claude 会暂停并让用户自己写代码来学习。核心机制：
三种内置风格

1. default — 默认风格

[DEFAULT_OUTPUT_STYLE_NAME]: null, // 返回 null，不注入额外指令

就是标准的 Claude Code 行为——简洁、直接、专注任务。getOutputStyleSection 收到 null 直接返回，不往系统提示里加任何东西。

2. Explanatory — 解释型

{
name: 'Explanatory',
description: 'Claude explains its implementation choices and codebase patterns',
keepCodingInstructions: true,
prompt: `...`
}

Claude 在写代码的同时附带教育性解释。核心机制是 Insights 块：

`★ Insight ─────────────────────────────────────`
[2-3 个关键教育点]
`─────────────────────────────────────────────────`

特点：

- 在写代码前后插入解释
- 聚焦于这个代码库特有的洞察，不是通用编程概念
- 可以超过通常的长度限制
- keepCodingInstructions: true → 保留编码指令（不覆盖默认行为）

3. Learning — 学习型

{
name: 'Learning',
description: 'Claude pauses and asks you to write small pieces of code for hands-on practice',
keepCodingInstructions: true,
prompt: `...`
}

最复杂的风格。Claude 会暂停并让用户自己写代码来学习。核心机制：

触发条件（Claude 生成 20+ 行代码时）：

- 设计决策（错误处理、数据结构选择）
- 有多种合理方案的业务逻辑
- 关键算法或接口定义

请求格式：
• Learn by Doing

Context: [已构建的内容和这个决策为什么重要]
Your Task: [具体的函数/代码段，引用文件和 TODO(human)]
Guidance: [要考虑的权衡和约束]

工作流程：

1. Claude 先在代码里插入 TODO(human) 标记
2. 发出 "Learn by Doing" 请求
3. 停止输出，等用户实现
4. 用户写完后，Claude 给出一个连接用户代码和 broader patterns 的洞察

TodoList 集成：
✓ "Set up component structure with placeholder for logic"
✓ "Request human collaboration on decision logic implementation" ← 标记需要用户参与
✓ "Integrate contribution and complete feature"

也包含 Explanatory 的 Insights 块。

### mcp_instructions

claude code实际上由有两层缓存
一层是软件这边的section cache ，第二层是大模型的prompt cache
对于这里的危险缓存来说，就是section cache
其他的在软件执行第一次的时候就会进行缓存（当然 大模型那边也是）
而mcp是每次都计算的危险缓存 因为用户可能随时连接或者断开mcp 所以每次invoke都要计算
当然 这种每次改变prompt的方式是不太符合大模型那边的prompt的
所以

```ts
isMcpInstructionsDeltaEnabled()
  ? null // ← delta 启用时返回 null
  : getMcpInstructionsSection(mcpClients); // ← 旧方案才走这里
```

当 delta 功能启用后，这个 section 返回 null，根本不产生内容，不会破坏 cache。MCP 指令改为通过 attachment 增量注入。所以 DANGEROUS_uncached 只是过渡期的 fallback，不是长期方案。

```ts
/**
 * True → announce MCP server instructions via persisted delta attachments.
 * False → prompts.ts keeps its DANGEROUS_uncachedSystemPromptSection
 * (rebuilt every turn; cache-busts on late connect).
 *
 * Env override for local testing: CLAUDE_CODE_MCP_INSTR_DELTA=true/false
 * wins over both ant bypass and the GrowthBook gate.
 */
export function isMcpInstructionsDeltaEnabled(): boolean {
  if (isEnvTruthy(process.env.CLAUDE_CODE_MCP_INSTR_DELTA)) return true;
  if (isEnvDefinedFalsy(process.env.CLAUDE_CODE_MCP_INSTR_DELTA)) return false;
  return process.env.USER_TYPE === "ant" || getFeatureValue_CACHED_MAY_BE_STALE("tengu_basalt_3kr", false);
}
```

这里注释也写明了这么处理并不是最终解决方案
最终的解决方案是：
persisted delta attachments —— 增量通知机制
只在 MCP 服务器状态变化时，发送增量通知 → 无变化时不发任何东西

```ts
maybe('mcp_instructions_delta', () =>
      Promise.resolve(
        getMcpInstructionsDeltaAttachment(
          toolUseContext.options.mcpClients,
          toolUseContext.options.tools,
          toolUseContext.options.mainLoopModel,
          messages,
        ),
      ),
    ),
```

attachments的具体机制不是这里讨论的主要问题，主要的点是在于知道mcp这类动态变化的服务器的更新周期是每次对话
为了更加符合prompt cache的机制，尽可能的把mcp放后面

### scratchpad

告诉模型哪里存放临时文件

```ts
/**
 * Returns instructions for using the scratchpad directory if enabled.
 * The scratchpad is a per-session directory where Claude can write temporary files.
 */
export function getScratchpadInstructions(): string | null {
  if (!isScratchpadEnabled()) {
    return null;
  }

  const scratchpadDir = getScratchpadDir();

  return `# Scratchpad Directory

IMPORTANT: Always use this scratchpad directory for temporary files instead of \`/tmp\` or other system temp directories:
\`${scratchpadDir}\`

Use this directory for ALL temporary file needs:
- Storing intermediate results or data during multi-step tasks
- Writing temporary scripts or configuration files
- Saving outputs that don't belong in the user's project
- Creating working files during analysis or processing
- Any file that would otherwise go to \`/tmp\`

Only use \`/tmp\` if the user explicitly requests it.

The scratchpad directory is session-specific, isolated from the user's project, and can be used freely without permission prompts.`;
}
```

### frc

Function Result Clearing（工具结果清理）
Claude Code 的对话越来越长时，早期的工具结果（Read 文件内容、Bash 输出、Grep 结果等）会占满上下文窗口。FRC 的作用是自动清理旧的工具结果来释放空间。告诉 Claude："旧的工具结果会被自动清除，最近 N 个结果会保留。"

```ts
function getFunctionResultClearingSection(model: string): string | null {
  if (!feature("CACHED_MICROCOMPACT") || !getCachedMCConfigForFRC) {
    return null;
  }
  const config = getCachedMCConfigForFRC();
  const isModelSupported = config.supportedModels?.some((pattern) => model.includes(pattern));
  if (!config.enabled || !config.systemPromptSuggestSummaries || !isModelSupported) {
    return null;
  }
  return `# Function Result Clearing

Old tool results will be automatically cleared from context to free up space. The ${config.keepRecent} most recent results are always kept.`;
}
```

### summarize_tool_results

告诉模型重要步骤记下来 因为可能之后会被清理

```ts
    systemPromptSection(
      'summarize_tool_results',
      () => SUMMARIZE_TOOL_RESULTS_SECTION,
    ),
const SUMMARIZE_TOOL_RESULTS_SECTION = `When working with tool results, write down any important information you might need later in your response, as the original tool result may be cleared later.`
```

这些跟之前提到过的micro compact有关

### numberic_length_anchors

```ts
...(process.env.USER_TYPE === 'ant'
      ? [
          systemPromptSection(
            'numeric_length_anchors',
            () =>
              'Length limits: keep text between tool calls to \u226425 words. Keep final responses to \u2264100 words unless the task requires more detail.',
          ),
        ]
      : []),
```

争对内部员工测试的prompt

### token_budget

关于token预算相关的内容，比较token是每一轮都会变化的，谁也不想模型做一半被打断，给定一个budget可能会让模型更直观的判断怎么样才能在有限的token内完成任务呢

```ts
...(feature('TOKEN_BUDGET')
      ? [
          // Cached unconditionally — the "When the user specifies..." phrasing
          // makes it a no-op with no budget active. Was DANGEROUS_uncached
          // (toggled on getCurrentTurnTokenBudget()), busting ~20K tokens per
          // budget flip. Not moved to a tail attachment: first-response and
          // budget-continuation paths don't see attachments (#21577).
          systemPromptSection(
            'token_budget',
            () =>
              'When the user specifies a token target (e.g., "+500k", "spend 2M tokens", "use 1B tokens"), your output token count will be shown each turn. Keep working until you approach the target \u2014 plan your work to fill it productively. The target is a hard minimum, not a suggestion. If you stop early, the system will automatically continue you.',
          ),
        ]
      : []),
```

### brief —— 简洁模式（KAIROS）

```ts
    ...(feature('KAIROS') || feature('KAIROS_BRIEF')
      ? [systemPromptSection('brief', () => getBriefSection())]
      : []),
```

开启简介模式

```ts
function getBriefSection(): string | null {
  if (!(feature("KAIROS") || feature("KAIROS_BRIEF"))) return null;
  if (!BRIEF_PROACTIVE_SECTION) return null;
  // Whenever the tool is available, the model is told to use it. The
  // /brief toggle and --brief flag now only control the isBriefOnly
  // display filter — they no longer gate model-facing behavior.
  if (!briefToolModule?.isBriefEnabled()) return null;
  // When proactive is active, getProactiveSection() already appends the
  // section inline. Skip here to avoid duplicating it in the system prompt.
  if ((feature("PROACTIVE") || feature("KAIROS")) && proactiveModule?.isProactiveActive()) return null;
  return BRIEF_PROACTIVE_SECTION;
}
```

最后注入的prompt大概是这样的

```ts
export const BRIEF_PROACTIVE_SECTION = `## Talking to the user

${BRIEF_TOOL_NAME} is where your replies go. Text outside it is visible if the user expands the detail view, but most won't — assume unread. Anything you want them to actually see goes through ${BRIEF_TOOL_NAME}. The failure mode: the real answer lives in plain text while ${BRIEF_TOOL_NAME} just says "done!" — they see "done!" and miss everything.

So: every time the user says something, the reply they actually read comes through ${BRIEF_TOOL_NAME}. Even for "hi". Even for "thanks".

If you can answer right away, send the answer. If you need to go look — run a command, read files, check something — ack first in one line ("On it — checking the test output"), then work, then send the result. Without the ack they're staring at a spinner.

For longer work: ack → work → result. Between those, send a checkpoint when something useful happened — a decision you made, a surprise you hit, a phase boundary. Skip the filler ("running tests...") — a checkpoint earns its place by carrying information.

Keep messages tight — the decision, the file:line, the PR number. Second person always ("your config"), never third.`;
```

这段指令直接改变模型的输出行为：

- 所有用户可见的回复必须通过 BriefTool 输出
- 先 ack，再工作，再发结果
- 长任务中间发 checkpoint（有信息量的进展更新）
- 跳过 filler（"running tests..."）
- 简洁：只保留决策、file:line、PR 编号
