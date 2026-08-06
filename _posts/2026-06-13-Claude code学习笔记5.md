---
layout: post
title: Claude code学习5 动态prompt的组装1
date: 2026-06-13 22:21:00 +0800
categories: [agent]
tags: [agent, claude-code, prompt-engineering]
---
## 动态prompt的组装
前面的静态prompt，由于KV cache的最大利用化，把动态变化的prompt放在了最后面
```ts
const dynamicSections = [
    systemPromptSection('session_guidance', () =>
      getSessionSpecificGuidanceSection(enabledTools, skillToolCommands),
    ),
    systemPromptSection('memory', () => loadMemoryPrompt()),
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
这里看到有两种类型的prompt，一种是
```ts
/**
 * Create a memoized system prompt section.
 * Computed once, cached until /clear or /compact.
 */
export function systemPromptSection(
  name: string,
  compute: ComputeFn,
): SystemPromptSection {
  return { name, compute, cacheBreak: false }
}
```
另一种是
```ts
/**
 * Create a volatile system prompt section that recomputes every turn.
 * This WILL break the prompt cache when the value changes.
 * Requires a reason explaining why cache-breaking is necessary.
 */
export function DANGEROUS_uncachedSystemPromptSection(
  name: string,
  compute: ComputeFn,
  _reason: string,
): SystemPromptSection {
  return { name, compute, cacheBreak: true }
}
```
二者也可以从注释中看出二者的生命周期的区别，一个是除了/compact和/clear之外，其他任何时候都会被缓存，一个是每次都会被计算的
之后将运行等在这里进行执行
### session_guidance
```ts
export async function resolveSystemPromptSections(
  sections: SystemPromptSection[],
): Promise<(string | null)[]> {
  const cache = getSystemPromptSectionCache()

  return Promise.all(
    sections.map(async s => {
      if (!s.cacheBreak && cache.has(s.name)) {
        return cache.get(s.name) ?? null
      }
      const value = await s.compute()
      setSystemPromptSectionCacheEntry(s.name, value)
      return value
    }),
  )
}
```
在组装动态prompt的时候，第一个组装的是类似与工具一类的prompt 主要逻辑是这个函数
```ts
function getSessionSpecificGuidanceSection(
  enabledTools: Set<string>,
  skillToolCommands: Command[],
): string | null {
  const hasAskUserQuestionTool = enabledTools.has(ASK_USER_QUESTION_TOOL_NAME)
  const hasSkills =
    skillToolCommands.length > 0 && enabledTools.has(SKILL_TOOL_NAME)
  const hasAgentTool = enabledTools.has(AGENT_TOOL_NAME)
  const searchTools = hasEmbeddedSearchTools()
    ? `\`find\` or \`grep\` via the ${BASH_TOOL_NAME} tool`
    : `the ${GLOB_TOOL_NAME} or ${GREP_TOOL_NAME}`

  const items = [
    hasAskUserQuestionTool
      ? `If you do not understand why the user has denied a tool call, use the ${ASK_USER_QUESTION_TOOL_NAME} to ask them.`
      : null,
    getIsNonInteractiveSession()
      ? null
      : `If you need the user to run a shell command themselves (e.g., an interactive login like \`gcloud auth login\`), suggest they type \`! <command>\` in the prompt — the \`!\` prefix runs the command in this session so its output lands directly in the conversation.`,
    // isForkSubagentEnabled() reads getIsNonInteractiveSession() — must be
    // post-boundary or it fragments the static prefix on session type.
    hasAgentTool ? getAgentToolSection() : null,
    ...(hasAgentTool &&
    areExplorePlanAgentsEnabled() &&
    !isForkSubagentEnabled()
      ? [
          `For simple, directed codebase searches (e.g. for a specific file/class/function) use ${searchTools} directly.`,
          `For broader codebase exploration and deep research, use the ${AGENT_TOOL_NAME} tool with subagent_type=${EXPLORE_AGENT.agentType}. This is slower than using ${searchTools} directly, so use this only when a simple, directed search proves to be insufficient or when your task will clearly require more than ${EXPLORE_AGENT_MIN_QUERIES} queries.`,
        ]
      : []),
    hasSkills
      ? `/<skill-name> (e.g., /commit) is shorthand for users to invoke a user-invocable skill. When executed, the skill gets expanded to a full prompt. Use the ${SKILL_TOOL_NAME} tool to execute them. IMPORTANT: Only use ${SKILL_TOOL_NAME} for skills listed in its user-invocable skills section - do not guess or use built-in CLI commands.`
      : null,
    DISCOVER_SKILLS_TOOL_NAME !== null &&
    hasSkills &&
    enabledTools.has(DISCOVER_SKILLS_TOOL_NAME)
      ? getDiscoverSkillsGuidance()
      : null,
    hasAgentTool &&
    feature('VERIFICATION_AGENT') &&
    // 3P default: false — verification agent is ant-only A/B
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_hive_evidence', false)
      ? `The contract: when non-trivial implementation happens on your turn, independent adversarial verification must happen before you report completion \u2014 regardless of who did the implementing (you directly, a fork you spawned, or a subagent). You are the one reporting to the user; you own the gate. Non-trivial means: 3+ file edits, backend/API changes, or infrastructure changes. Spawn the ${AGENT_TOOL_NAME} tool with subagent_type="${VERIFICATION_AGENT_TYPE}". Your own checks, caveats, and a fork's self-checks do NOT substitute \u2014 only the verifier assigns a verdict; you cannot self-assign PARTIAL. Pass the original user request, all files changed (by anyone), the approach, and the plan file path if applicable. Flag concerns if you have them but do NOT share test results or claim things work. On FAIL: fix, resume the verifier with its findings plus your fix, repeat until PASS. On PASS: spot-check it \u2014 re-run 2-3 commands from its report, confirm every PASS has a Command run block with output that matches your re-run. If any PASS lacks a command block or diverges, resume the verifier with the specifics. On PARTIAL (from the verifier): report what passed and what could not be verified.`
      : null,
  ].filter(item => item !== null)

  if (items.length === 0) return null
  return ['# Session-specific guidance', ...prependBullets(items)].join('\n')
}
```
这里主要处理了几个工具的关系
第一个就是`hasAskUserQuestionTool`，如果有的话模型可以主动向用户提问 prompt引导模型去这么做
第二个`getIsNonInteractiveSession()`，这个函数会判断当前是否是交互式会话，如果是的话，模型将不能进行交互式的操作，只能进行非交互式的操作，比如执行命令，或者调用工具
第三个`hasAgentTool`，这个主要是关于子agent fork的，会告诉模型怎么去fork一个subagent
```ts
    // isForkSubagentEnabled() reads getIsNonInteractiveSession() — must be
    // post-boundary or it fragments the static prefix on session type.
function getAgentToolSection(): string {
  return isForkSubagentEnabled()
    ? `Calling ${AGENT_TOOL_NAME} without a subagent_type creates a fork, which runs in the background and keeps its tool output out of your context \u2014 so you can keep chatting with the user while it works. Reach for it when research or multi-step implementation work would otherwise fill your context with raw output you won't need again. **If you ARE the fork** \u2014 execute directly; do not re-delegate.`
    : `Use the ${AGENT_TOOL_NAME} tool with specialized agents when the task at hand matches the agent's description. Subagents are valuable for parallelizing independent queries or for protecting the main context window from excessive results, but they should not be used excessively when not needed. Importantly, avoid duplicating work that subagents are already doing - if you delegate research to a subagent, do not also perform the same searches yourself.`
}
```
`areExplorePlanAgentsEnabled()`但没有subagent的时候，会引导在较为复杂的任务上使用这个ExplorePlanAgents
`hasSkills`故名思意，就是有关于skill的相关配置，引导llm可以使用skill
总的来说，这里都是引导并且告诉llm什么工具可以用，怎么用的
### memory
`systemPromptSection('memory', () => loadMemoryPrompt()),`这是 Claude Code 的记忆系统加载器，负责把用户的记忆文件注入到 system prompt 里
```ts
/**
 * Load the unified memory prompt for inclusion in the system prompt.
 * Dispatches based on which memory systems are enabled:
 *   - auto + team: combined prompt (both directories)
 *   - auto only: memory lines (single directory)
 * Team memory requires auto memory (enforced by isTeamMemoryEnabled), so
 * there is no team-only branch.
 *
 * Returns null when auto memory is disabled.
 */
export async function loadMemoryPrompt(): Promise<string | null> {
  const autoEnabled = isAutoMemoryEnabled()

  const skipIndex = getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_moth_copse',
    false,
  )

  // KAIROS daily-log mode takes precedence over TEAMMEM: the append-only
  // log paradigm does not compose with team sync (which expects a shared
  // MEMORY.md that both sides read + write). Gating on `autoEnabled` here
  // means the !autoEnabled case falls through to the tengu_memdir_disabled
  // telemetry block below, matching the non-KAIROS path.
  if (feature('KAIROS') && autoEnabled && getKairosActive()) {
    logMemoryDirCounts(getAutoMemPath(), {
      memory_type:
        'auto' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return buildAssistantDailyLogPrompt(skipIndex)
  }

  // Cowork injects memory-policy text via env var; thread into all builders.
  const coworkExtraGuidelines =
    process.env.CLAUDE_COWORK_MEMORY_EXTRA_GUIDELINES
  const extraGuidelines =
    coworkExtraGuidelines && coworkExtraGuidelines.trim().length > 0
      ? [coworkExtraGuidelines]
      : undefined

  if (feature('TEAMMEM')) {
    if (teamMemPaths!.isTeamMemoryEnabled()) {
      const autoDir = getAutoMemPath()
      const teamDir = teamMemPaths!.getTeamMemPath()
      // Harness guarantees these directories exist so the model can write
      // without checking. The prompt text reflects this ("already exists").
      // Only creating teamDir is sufficient: getTeamMemPath() is defined as
      // join(getAutoMemPath(), 'team'), so recursive mkdir of the team dir
      // creates the auto dir as a side effect. If the team dir ever moves
      // out from under the auto dir, add a second ensureMemoryDirExists call
      // for autoDir here.
      await ensureMemoryDirExists(teamDir)
      logMemoryDirCounts(autoDir, {
        memory_type:
          'auto' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      logMemoryDirCounts(teamDir, {
        memory_type:
          'team' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      return teamMemPrompts!.buildCombinedMemoryPrompt(
        extraGuidelines,
        skipIndex,
      )
    }
  }

  if (autoEnabled) {
    const autoDir = getAutoMemPath()
    // Harness guarantees the directory exists so the model can write without
    // checking. The prompt text reflects this ("already exists").
    await ensureMemoryDirExists(autoDir)
    logMemoryDirCounts(autoDir, {
      memory_type:
        'auto' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return buildMemoryLines(
      'auto memory',
      autoDir,
      extraGuidelines,
      skipIndex,
    ).join('\n')
  }

  logEvent('tengu_memdir_disabled', {
    disabled_by_env_var: isEnvTruthy(
      process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY,
    ),
    disabled_by_setting:
      !isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY) &&
      getInitialSettings().autoMemoryEnabled === false,
  })
  // Gate on the GB flag directly, not isTeamMemoryEnabled() — that function
  // checks isAutoMemoryEnabled() first, which is definitionally false in this
  // branch. We want "was this user in the team-memory cohort at all."
  if (getFeatureValue_CACHED_MAY_BE_STALE('tengu_herring_clock', false)) {
    logEvent('tengu_team_memdir_disabled', {})
  }
  return null
}
```
他有三种记忆模式，分别是`Auto Memory（标准个人模式）`、`Team Memory（团队模式）`和`Kairos Daily Log（Kairos 日志模式）`
#### Auto memory
CLAUDE.md 更像“长期指令/规则”
AutoMem / TeamMem 更像“长期知识库”
这里的设计可以参考一下b站这位up讲的视频
{% include embed/bilibili.html id='BV1ZA93BtEKW' %}
落盘（本地和持久化）、更新和维护 => 写入
总的来说这些md文件都有一个frontmatter，用来方便做渐进式披露
目录结构
```ts
~/.claude/projects/<sanitized-git-root>/memory/
├── MEMORY.md                  ← 索引文件（每次对话都加载到上下文）
├── user_role.md               ← 记忆文件：带 YAML frontmatter
├── feedback_testing.md
├── project_auth_rewrite.md
└── reference_linear_ingest.md
```
再来讲讲几种记忆的分类：
```
- src/utils/claudemd.ts
    - src/utils/memory/types.ts：
        - Managed：系统级托管规则
        - User：用户级 ~/.claude/CLAUDE.md
        - Project：仓库内 CLAUDE.md、.claude/CLAUDE.md、.claude/rules/*.md
        - Local：私有项目级 CLAUDE.local.md
        - AutoMem：自动记忆目录的 MEMORY.md
        - TeamMem：团队共享记忆目录的 MEMORY.md
```
内容语义分类（taxonomy，`AutoMemory`）: user/feedback/project/references
##### TYPES_SECTION_INDIVIDUAL
###### user
`user_role`主要讲的是用户是谁，本质上是帮助模型来判断什么样的输出是好的，例如你是一个没有接触过编程的小白，那去讲一些太过细节的问题以及内容就是不太适合的，毕竟看不懂；如果你是一个大牛，想要得到的答案肯定跟小白不一样，本质是让模型输出更符合你的意图的一个辅助性工具
```
~\Claude-Code\src\memdir\memoryTypes.ts
  '<type>',
  '    <name>user</name>',
  '    <scope>always private</scope>',
  "    <description>Contain information about the user's role, goals, responsibilities, and knowledge. Great user memories help you tailor your future behavior to the user's preferences and perspective. Your goal in reading and writing these memories is to build up an understanding of who the user is and how you can be most helpful to them specifically. For example, you should collaborate with a senior software engineer differently than a student who is coding for the very first time. Keep in mind, that the aim here is to be helpful to the user. Avoid writing memories about the user that could be viewed as a negative judgement or that are not relevant to the work you're trying to accomplish together.</description>",
  "    <when_to_save>When you learn any details about the user's role, preferences, responsibilities, or knowledge</when_to_save>",
  "    <how_to_use>When your work should be informed by the user's profile or perspective. For example, if the user is asking you to explain a part of the code, you should answer that question in a way that is tailored to the specific details that they will find most valuable or that helps them build their mental model in relation to domain knowledge they already have.</how_to_use>",
  '    <examples>',
  "    user: I'm a data scientist investigating what logging we have in place",
  '    assistant: [saves private user memory: user is a data scientist, currently focused on observability/logging]',
  '',
  "    user: I've been writing Go for ten years but this is my first time touching the React side of this repo",
  "    assistant: [saves private user memory: deep Go expertise, new to React and this project's frontend — frame frontend explanations in terms of backend analogues]",
  '    </examples>',
  '</type>',
```
###### feedback
`feedback_testing`是最“行为约束型”的 memory，关注“你以后应该怎么做”，并且是而非个人风格偏好，保存为团队，对于这个项目的整体feedback，例如我有一个项目需要测试的时候启动conda环境中的一个固定环境，而非默认的python编译器，就应当是记在feedback_testing中的一段内容，因为这个环境是项目运行环境，不以我个人偏好而改变
feedback 不只记录负反馈，也记录正反馈。“不要 mock DB” 是 feedback，“这个 bundled PR 方式对” 也是 feedback
为什么要有解释呢：因为这类记忆不是像代码一样的静态事实，而是可迁移规则。没有 Why，模型以后只能机械套用；有了 Why，它才知道边界条件。这也是 frontmatter 示例里专门强调 feedback/project 正文结构的原因：
```
~\Claude-Code\src\memdir\memoryTypes.ts
  '<type>',
  '    <name>feedback</name>',
  '    <scope>default to private. Save as team only when the guidance is clearly a project-wide convention that every contributor should follow (e.g., a testing policy, a build invariant), not a personal style preference.</scope>',
  "    <description>Guidance the user has given you about how to approach work — both what to avoid and what to keep doing. These are a very important type of memory to read and write as they allow you to remain coherent and responsive to the way you should approach work in the project. Record from failure AND success: if you only save corrections, you will avoid past mistakes but drift away from approaches the user has already validated, and may grow overly cautious. Before saving a private feedback memory, check that it doesn't contradict a team feedback memory — if it does, either don't save it or note the override explicitly.</description>",
  '    <when_to_save>Any time the user corrects your approach ("no not that", "don\'t", "stop doing X") OR confirms a non-obvious approach worked ("yes exactly", "perfect, keep doing that", accepting an unusual choice without pushback). Corrections are easy to notice; confirmations are quieter — watch for them. In both cases, save what is applicable to future conversations, especially if surprising or not obvious from the code. Include *why* so you can judge edge cases later.</when_to_save>',
  '    <how_to_use>Let these memories guide your behavior so that the user and other users in the project do not need to offer the same guidance twice.</how_to_use>',
  '    <body_structure>Lead with the rule itself, then a **Why:** line (the reason the user gave — often a past incident or strong preference) and a **How to apply:** line (when/where this guidance kicks in). Knowing *why* lets you judge edge cases instead of blindly following the rule.</body_structure>',
  '    <examples>',
  "    user: don't mock the database in these tests — we got burned last quarter when mocked tests passed but the prod migration failed",
  '    assistant: [saves team feedback memory: integration tests must hit a real database, not mocks. Reason: prior incident where mock/prod divergence masked a broken migration. Team scope: this is a project testing policy, not a personal preference]',
  '',
  '    user: stop summarizing what you just did at the end of every response, I can read the diff',
  "    assistant: [saves private feedback memory: this user wants terse responses with no trailing summaries. Private because it's a communication preference, not a project convention]",
  '',
  "    user: yeah the single bundled PR was the right call here, splitting this one would've just been churn",
  '    assistant: [saves private feedback memory: for refactors in this area, user prefers one bundled PR over many small ones. Confirmed after I chose this approach — a validated judgment call, not a correction]',
  '    </examples>',
  '</type>',
  '<type>',
```
###### project
对于项目来说，如果我们要去存一个专门的记忆去记所谓的项目细节例如代码这是不太可能的
第一 对于项目来说，代码就在那里，特地存起来是多此一举
第二 代码会变，一旦上下文被你的memory污染误导那效果确实不好
所以类 memory 的核心是“非代码可推导”，所以 project 并不是“项目知识大杂烩”，而是“代码外的项目现实”。
project 往往在 recall 阶段最有价值，因为用户问“为什么要改这个”“最近这个方向的约束是什么”时，代码本身不足以回答。
```
  '<type>',
  '    <name>project</name>',
  '    <scope>private or team, but strongly bias toward team</scope>',
  '    <description>Information that you learn about ongoing work, goals, initiatives, bugs, or incidents within the project that is not otherwise derivable from the code or git history. Project memories help you understand the broader context and motivation behind the work users are working on within this working directory.</description>',
  '    <when_to_save>When you learn who is doing what, why, or by when. These states change relatively quickly so try to keep your understanding of this up to date. Always convert relative dates in user messages to absolute dates when saving (e.g., "Thursday" → "2026-03-05"), so the memory remains interpretable after time passes.</when_to_save>',
  "    <how_to_use>Use these memories to more fully understand the details and nuance behind the user's request, anticipate coordination issues across users, make better informed suggestions.</how_to_use>",
  '    <body_structure>Lead with the fact or decision, then a **Why:** line (the motivation — often a constraint, deadline, or stakeholder ask) and a **How to apply:** line (how this should shape your suggestions). Project memories decay fast, so the why helps future-you judge whether the memory is still load-bearing.</body_structure>',
  '    <examples>',
  "    user: we're freezing all non-critical merges after Thursday — mobile team is cutting a release branch",
  '    assistant: [saves team project memory: merge freeze begins 2026-03-05 for mobile release cut. Flag any non-critical PR work scheduled after that date]',
  '',
  "    user: the reason we're ripping out the old auth middleware is that legal flagged it for storing session tokens in a way that doesn't meet the new compliance requirements",
  '    assistant: [saves team project memory: auth middleware rewrite is driven by legal/compliance requirements around session token storage, not tech-debt cleanup — scope decisions should favor compliance over ergonomics]',
  '    </examples>',
  '</type>',
```
###### reference
reference: 不是存事实本身，而是存“去哪找事实”。
  - 典型内容：
      - 某个 Linear project 是什么
      - 哪个 Grafana dashboard 看什么
      - 哪个 Slack channel 存什么信息
```
  '<type>',
  '    <name>reference</name>',
  '    <description>Stores pointers to where information can be found in external systems. These memories allow you to remember where to look to find up-to-date information outside of the project directory.</description>',
  '    <when_to_save>When you learn about resources in external systems and their purpose. For example, that bugs are tracked in a specific project in Linear or that feedback can be found in a specific Slack channel.</when_to_save>',
  '    <how_to_use>When the user references an external system or information that may be in an external system.</how_to_use>',
  '    <examples>',
  '    user: check the Linear project "INGEST" if you want context on these tickets, that\'s where we track all pipeline bugs',
  '    assistant: [saves reference memory: pipeline bugs are tracked in Linear project "INGEST"]',
  '',
  "    user: the Grafana board at grafana.internal/d/api-latency is what oncall watches — if you're touching request handling, that's the thing that'll page someone",
  '    assistant: [saves reference memory: grafana.internal/d/api-latency is the oncall latency dashboard — check it when editing request-path code]',
  '    </examples>',
  '</type>',
```
###### prompt组装
指令层次结构

buildMemoryLines 拼装出的完整指令结构：
```
# auto memory                           ← 标题
                                        ← 1. 总体定位
You have a persistent, file-based...    ← "你应该逐步建立记忆"
                                        ← 2. 显式触发规则
If the user explicitly asks...           ← 用户说"记住这个" → 立即保存
                                        ← 3. 类型分类
## Types of memory                       ← 四类型定义（带示例）
                                        ← 4. 禁止保存
## What NOT to save                      ← 代码/git/CLAUDE.md 等排除项
                                        ← 5. 写入方法
## How to save memories                  ← 两步写入流程
                                        ← 6. 读取时机
## When to access memories               ← 何时读、何时忽略
                                        ← 7. 读取验证
## Before recommending from memory       ← 验证记忆中的具体引用是否还存在
                                        ← 8. 与其他持久化机制的边界
## Memory and other forms of persistence ← Plan vs Task vs Memory 的分工
                                        ← 9. 搜索历史
## Searching past context               ← grep 记忆目录和会话记录
```
下面是拼装的代码
```ts
export const MEMORY_FRONTMATTER_EXAMPLE: readonly string[] = [
  '```markdown',
  '---',
  'name: {{memory name}}',
  'description: {{one-line description — used to decide relevance in future conversations, so be specific}}',
  `type: {{${MEMORY_TYPES.join(', ')}}}`,
  '---',
  '',
  '{{memory content — for feedback/project types, structure as: rule/fact, then **Why:** and **How to apply:** lines}}',
  '```',
]


export function buildMemoryLines(
  displayName: string,
  memoryDir: string,
  extraGuidelines?: string[],
  skipIndex = false,
): string[] {
  const howToSave = skipIndex
    ? [
        '## How to save memories',
        '',
        'Write each memory to its own file (e.g., `user_role.md`, `feedback_testing.md`) using this frontmatter format:',
        '',
        ...MEMORY_FRONTMATTER_EXAMPLE,
        '',
        '- Keep the name, description, and type fields in memory files up-to-date with the content',
        '- Organize memory semantically by topic, not chronologically',
        '- Update or remove memories that turn out to be wrong or outdated',
        '- Do not write duplicate memories. First check if there is an existing memory you can update before writing a new one.',
      ]
    : [
        '## How to save memories',
        '',
        'Saving a memory is a two-step process:',
        '',
        '**Step 1** — write the memory to its own file (e.g., `user_role.md`, `feedback_testing.md`) using this frontmatter format:',
        '',
        ...MEMORY_FRONTMATTER_EXAMPLE,
        '',
        `**Step 2** — add a pointer to that file in \`${ENTRYPOINT_NAME}\`. \`${ENTRYPOINT_NAME}\` is an index, not a memory — each entry should be one line, under ~150 characters: \`- [Title](file.md) — one-line hook\`. It has no frontmatter. Never write memory content directly into \`${ENTRYPOINT_NAME}\`.`,
        '',
        `- \`${ENTRYPOINT_NAME}\` is always loaded into your conversation context — lines after ${MAX_ENTRYPOINT_LINES} will be truncated, so keep the index concise`,
        '- Keep the name, description, and type fields in memory files up-to-date with the content',
        '- Organize memory semantically by topic, not chronologically',
        '- Update or remove memories that turn out to be wrong or outdated',
        '- Do not write duplicate memories. First check if there is an existing memory you can update before writing a new one.',
      ]

  const lines: string[] = [
    `# ${displayName}`,
    '',
    `You have a persistent, file-based memory system at \`${memoryDir}\`. ${DIR_EXISTS_GUIDANCE}`,
    '',
    "You should build up this memory system over time so that future conversations can have a complete picture of who the user is, how they'd like to collaborate with you, what behaviors to avoid or repeat, and the context behind the work the user gives you.",
    '',
    'If the user explicitly asks you to remember something, save it immediately as whichever type fits best. If they ask you to forget something, find and remove the relevant entry.',
    '',
    ...TYPES_SECTION_INDIVIDUAL,
    ...WHAT_NOT_TO_SAVE_SECTION,
    '',
    ...howToSave,
    '',
    ...WHEN_TO_ACCESS_SECTION,
    '',
    ...TRUSTING_RECALL_SECTION,
    '',
    '## Memory and other forms of persistence',
    'Memory is one of several persistence mechanisms available to you as you assist the user in a given conversation. The distinction is often that memory can be recalled in future conversations and should not be used for persisting information that is only useful within the scope of the current conversation.',
    '- When to use or update a plan instead of memory: If you are about to start a non-trivial implementation task and would like to reach alignment with the user on your approach you should use a Plan rather than saving this information to memory. Similarly, if you already have a plan within the conversation and you have changed your approach persist that change by updating the plan rather than saving a memory.',
    '- When to use or update tasks instead of memory: When you need to break your work in current conversation into discrete steps or keep track of your progress use tasks instead of saving to memory. Tasks are great for persisting information about the work that needs to be done in the current conversation, but memory should be reserved for information that will be useful in future conversations.',
    '',
    ...(extraGuidelines ?? []),
    '',
  ]

  lines.push(...buildSearchingPastContextSection(memoryDir))

  return lines
}
```
buildMemoryLines 本质上是一份精心编排的 system prompt，每个 section 都经过 eval 验证（注释里多次提到 eval case 编号）。它不是一次性写好的——是通过 A/B 测试逐步迭代出来的：

- H1（验证函数/文件引用）：0/2 → 3/3
- H5（读取端噪声拒绝）：0/2 → 3/3
- H6（忽略指令污染）：1/3 → 解决
- 位置敏感：同一个指令放在不同 section 效果不同（H1 放在"When to access"里 0/3，独立成 section 3/3）

1. WHAT_NOT_TO_SAVE_SECTION —— 不写什么

文件：memoryTypes.ts:183-195

硬排除列表，即使用户明确要求也保存：

❌ 代码模式、架构、文件路径、项目结构  → 能从代码推导
❌ Git 历史、最近改动                 → git log 是权威来源
❌ 调试方案、修复方法                  → 修复在代码里，上下文在 commit 里
❌ CLAUDE.md 已有的内容                → 重复
❌ 临时任务状态                        → 会话结束就失效

最后一句是关键防线：

▎ 'These exclusions apply even when the user explicitly asks you to save.
▎ If they ask you to save a PR list or activity summary, ask what was
▎ surprising or non-obvious about it — that is the part worth keeping.'

用户说"保存这周的 PR 列表" → Claude 不应该照做，而是问"其中有什么出乎意料或非显而易见的部分"——那才是值得保存的。

---
2. howToSave —— 怎么写

由 buildMemoryLines 根据 skipIndex 动态生成两种版本：

标准模式（两步）：
Step 1: 写记忆文件（带 frontmatter: name/description/type）
Step 2: 在 MEMORY.md 添加一行索引指针
        格式: `- [Title](file.md) — one-line hook`（<150 字符）

简化模式（skipIndex = true，跳过索引）：
直接写记忆文件，不维护 MEMORY.md

两种模式共有的规则：
- name/description/type 保持与内容一致
- 按主题组织，不按时间
- 过时的记忆更新或删除
- 写之前先检查是否已有可更新的记忆（防重复）

---
3. WHEN_TO_ACCESS_SECTION —— 何时读

文件：memoryTypes.ts:216-222

'- When memories seem relevant, or the user references prior-conversation work.',
'- You MUST access memory when the user explicitly asks you to check, recall, or remember.',
'- If the user says to *ignore* or *not use* memory: proceed as if MEMORY.md were empty.
   Do not apply remembered facts, cite, compare against, or mention memory content.',
MEMORY_DRIFT_CAVEAT,

三条规则对应三种场景：
```
┌──────────────────────┬─────────────────────────────────┐
│       用户行为       │           Claude 响应           │
├──────────────────────┼─────────────────────────────────┤
│ 正常对话，上下文相关 │ 主动读取记忆                    │
├──────────────────────┼─────────────────────────────────┤
│ "查一下记忆"         │ 必须读取                        │
├──────────────────────┼─────────────────────────────────┤
│ "忽略关于 X 的记忆"  │ 当作 MEMORY.md 是空的，完全不提 │
└──────────────────────┴─────────────────────────────────┘
```
MEMORY_DRIFT_CAVEAT 是读取端的防御：

▎ 记忆可能过时。把记忆当作某个时间点的事实。回答前验证记忆是否仍然正确。
▎ 如果记忆与当前信息冲突，信任当前观察——并更新或删除过时的记忆。

---
4. TRUSTING_RECALL_SECTION —— 读完怎么用

文件：memoryTypes.ts:240-256

标题故意用了行动导向的措辞（Before recommending from memory 而不是抽象的 Trusting what you recall），因为 eval 证明标题的措辞影响执行率。

'A memory that names a specific function, file, or flag is a claim that it
existed *when the memory was written*. It may have been renamed, removed,
or never merged. Before recommending it:'

'- If the memory names a file path: check the file exists.',
'- If the memory names a function or flag: grep for it.',
'- If the user is about to act on your recommendation: verify first.',

核心原则：

▎ "The memory says X exists" is not the same as "X exists now."

对于快照型记忆（活动日志、架构快照）：

▎ 如果用户问的是最近或当前状态，优先用 git log 或读代码，
▎ 而不是回忆快照。

---
五个 Section 的逻辑链

TYPES_SECTION     →  记忆的"数据模型"（存什么、什么结构）
WHAT_NOT_TO_SAVE  →  过滤器（什么不该进模型）
howToSave         →  写入协议（怎么持久化）
WHEN_TO_ACCESS    →  读取策略（什么时候读、什么时候不读）
TRUSTING_RECALL   →  使用策略（读完之后怎么用、怎么验证）

这条链从写入到读取到使用，形成完整闭环。每个环节都有 eval 验证过的具体指令，不是泛泛而谈的"请使用记忆系统"。

#### 模式二：Team Memory（团队记忆模式）

本质

私有 + 共享双目录系统，通过 Anthropic 服务器 API 在团队成员间同步。

目录结构

~/.claude/projects/<sanitized-git-root>/memory/
├── MEMORY.md              ← 个人索引
├── user_role.md           ← 个人记忆（private）
├── feedback_style.md      ← 个人反馈（private）
└── team/                  ← 团队共享目录
    ├── MEMORY.md          ← 团队索引
    ├── feedback_policy.md ← 团队约定（team）
    ├── project_freeze.md  ← 项目状态（team）
    └── reference_linear.md← 外部指针（team）

scope 分配规则

每个记忆类型有明确的 private/team 倾向（memoryTypes.ts:37-106）：
```
┌───────────┬───────────────────────────┬────────────────────────────┐
│   类型    │           scope           │            理由            │
├───────────┼───────────────────────────┼────────────────────────────┤
│ user      │ always private            │ 个人信息永远不共享         │
├───────────┼───────────────────────────┼────────────────────────────┤
│ feedback  │ default private           │ 个人风格偏好 vs 项目级约定 │
├───────────┼───────────────────────────┼────────────────────────────┤
│ project   │ strongly bias toward team │ 项目状态通常是团队共享的   │
├───────────┼───────────────────────────┼────────────────────────────┤
│ reference │ usually team              │ 外部系统指针对所有人生效   │
└───────────┴───────────────────────────┴────────────────────────────┘
├───────────┼───────────────────────────┼────────────────────────────┤
│ user      │ always private            │ 个人信息永远不共享         │
├───────────┼───────────────────────────┼────────────────────────────┤
│ feedback  │ default private           │ 个人风格偏好 vs 项目级约定 │
├───────────┼───────────────────────────┼────────────────────────────┤
│ project   │ strongly bias toward team │ 项目状态通常是团队共享的   │
├───────────┼───────────────────────────┼────────────────────────────┤
│ reference │ usually team              │ 外部系统指针对所有人生效   │
└───────────┴───────────────────────────┴────────────────────────────┘
```
模型在写入时需要判断 scope，选择写到 memory/ 还是 memory/team/。

同步机制

不是 git，不是共享挂载——是 Anthropic 服务器 API：

API 端点：
GET  /api/claude_code/team_memory?repo={owner/repo}      ← 拉取全部
GET  /api/claude_code/team_memory?repo={owner/repo}&view=hashes  ← 仅校验和
PUT  /api/claude_code/team_memory?repo={owner/repo}      ← 推送变更

同步流程：
1. Pull first — 从服务器拉取，写入本地 team/ 目录（服务器优先）
2. Push second — 计算 delta（本地 SHA-256 与服务器校验和不同的 key），只上传变更部分

冲突解决：
- 使用 ETag 条件请求（If-Match）
- 412 Precondition Failed → 刷新校验和，重试最多 2 次
- 本地胜出 — 同一 key 双方都改了，本地版本覆盖

实时同步：
- fs.watch({ recursive: true }) 监听 team/ 目录
- 2 秒 debounce 后触发 push
- notifyTeamMemoryWrite() hook 在 FileWriteTool/FileEditTool 后触发（防止 fs.watch 漏事件）

安全机制

1. 路径遍历防护（teamMemPaths.ts）：

两轮验证：
- 第一轮：字符串级 resolve() + startsWith(teamDir) 检查
- 第二轮：realpath() 解析符号链接，确认真实路径仍在 team 目录内

防攻击手段：
- 空字节注入（\0）
- URL 编码遍历（%2e%2e%2f）
- Unicode 规范化攻击（NFKC 全角字符）
- 反斜杠（Windows 路径分隔符）
- 绝对路径

2. 密钥扫描（teamMemSecretGuard.ts）：

- 写入时扫描：如果内容含密钥，直接阻止写入
- 推送时扫描：含密钥的文件跳过上传

3. 配置安全：

autoMemoryDirectory 在 settings.json 中配置时，projectSettings（.claude/settings.json）被故意排除——防止恶意仓库提交 settings.json 把记忆目录指向 ~/.ssh。


#### 模式三：Assistant Daily-Log（助手日志模式）

本质

追加写入的日志 + 异步蒸馏。适配长期运行的助手会话（KAIROS feature）。

目录结构
```
~/.claude/projects/<sanitized-git-root>/memory/
├── MEMORY.md                    ← 蒸馏后的索引（/dream 维护）
├── user_role.md                 ← 蒸馏后的主题文件
├── feedback_testing.md
└── logs/
    └── 2026/
        └── 06/
            ├── 2026-06-14.md   ← 每日日志（append-only）
            └── 2026-06-15.md
```
写入流程（append-only）

模型只做一件事：往当天的日志文件追加带时间戳的条目。

 2026-06-15
- 10:30 用户说他们团队用 Linear 跟踪 pipeline bug，项目名 INGEST
- 11:15 用户纠正：不要用 npm，用 bun
- 14:00 了解到 auth middleware 重写是因为法律合规要求

关键设计：
- 路径用模式 logs/YYYY/MM/YYYY-MM-DD.md 描述，不是今天的字面路径
- 因为系统提示被 systemPromptSection 缓存，不会因日期变化而失效
- 模型从 date_change attachment 推导当前日期
- MEMORY.md 仍然加载到上下文，但模型不直接编辑它

蒸馏机制（/dream）

/dream 是一个 4 阶段结构化 prompt（consolidationPrompt.ts）：

Phase 1: Orient
  → ls 记忆目录，读 MEMORY.md，浏览现有主题文件

Phase 2: Gather recent signal
  → 读日志文件（logs/YYYY/MM/YYYY-MM-DD.md）
  → 识别漂移的记忆
  → 可选：grep JSONL 会话记录

Phase 3: Consolidate
  → 写入或更新主题文件
  → 合并新信号到现有文件（去重）
  → 相对日期转绝对日期（"昨天" → "2026-06-14"）
  → 删除被推翻的事实

Phase 4: Prune and index
  → 更新 MEMORY.md，保持 200 行 / 25KB 以内
  → 每条索引一行，< 150 字符
  → 删除过时指针，解决矛盾

autoDream（自动蒸馏）

autoDream 是后台自动运行 /dream 的机制（autoDream.ts）。5 层 gate：

1. Feature gate    → isAutoDreamEnabled()（settings.json 或 GrowthBook）
2. Time gate       → 距上次蒸馏 ≥ 24 小时
3. Scan throttle   → 至多每 10 分钟检查一次
4. Session gate    → 自上次蒸馏后 ≥ 5 个新会话
5. Lock gate       → 无其他进程在蒸馏（PID 锁文件）

全部通过后：
1. 获取锁（.consolidate-lock，mtime = lastConsolidatedAt，body = PID）
2. 注册 DreamTask（UI 可见）
3. 运行 forked agent（受限工具访问）
4. 完成后在主会话注入 "Improved N memory files" 消息

失败回滚：锁 mtime 回退到获取前的值，下次 turn 会重新尝试。

日期翻转机制

getDateChangeAttachments()（attachments.ts:1415-1444）：

每 turn 检查：
  当前日期 vs 上次发出的日期
  ↓ 不同（跨午夜）
  → 发出 { type: 'date_change', newDate: '2026-06-16' }
  → 渲染为："The date has changed. Today's date is now 2026-06-16."

为什么追加在尾部而不是头部：保留 prompt cache 前缀。如果清除头部的日期，整个对话会变成 cache_creation（~920K tokens），凌晨跨日的代价极大。尾部的 stale date 是缓存稳定性的刻意权衡。

