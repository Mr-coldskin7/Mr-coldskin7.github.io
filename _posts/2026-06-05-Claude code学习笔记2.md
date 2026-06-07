---
title: Claude code学习2
date: 2026-06-05 20:21:00 +0800
categories: [Study, agent]
tags: [study]
---
从管理上下文的角度上来看，如果把读文件的内容原封不动给回llm，llm大概率是会超出上下文或者注意力涣散的

## 压缩管道
压缩管道是 Claude Code 处理上下文窗口管理的核心机制。

  为什么需要压缩

  Claude 的上下文窗口有 token 上限（比如 200k）。但一次对话可能涉及：
  - 读了很多文件
  - 多轮工具调用返回大量结果
  - 长对话历史累积

  放着不管，上下文会爆。

  压缩管道做什么

  大致流程：

  原始上下文 → 评估 token 量 → 触发压缩 → 输出精简上下文

  具体手段包括：

  1. 摘要化 — 把长对话历史浓缩成关键信息的摘要，丢掉细节
  2. 工具结果裁剪 — 大文件读取结果只保留关键片段，不塞完整内容
  3. 系统提示动态调整 — 根据对话阶段调整注入的上下文量
  4. 优先级排序 — 哪些信息更重要，优先保留

  为什么说它重要

  这就是 Harness 的核心价值之一：

  - 不压缩 → 上下文溢出，模型丢失早期信息，任务失败
  - 粗暴压缩 → 丢掉关键上下文，模型做出错误决策
  - 智能压缩 → 保留关键信息，丢弃噪音，维持长对话质量

### 整体流程
```ts
let messagesForQuery = [...getMessagesAfterCompactBoundary(messages)]
let tracking = autoCompactTracking

const persistReplacements =
    querySource.startsWith('agent:') ||
    querySource.startsWith('repl_main_thread')

if (feature('HISTORY_SNIP')) {
  messagesForQuery = snipCompactIfNeeded(messagesForQuery).messages
}

const microcompactResult = await deps.microcompact(messagesForQuery, toolUseContext)
messagesForQuery = microcompactResult.messages

if (feature('CONTEXT_COLLAPSE') && contextCollapse) {
  messagesForQuery = (await contextCollapse.applyCollapsesIfNeeded(...)).messages
}

const { compactionResult } = await deps.autocompact(messagesForQuery, ...)
if (compactionResult) {
  const postCompactMessages = buildPostCompactMessages(compactionResult)
  for (const message of postCompactMessages) yield message
}
```
整体流程上分为
预算缩减：先限制单个工具结果体积，把超大日志、搜索结果或媒体描述替换成预览与引用，避免一个工具输出支配整轮请求。
Snip：轻量裁剪最旧历史，并把释放的 snipTokensFreed 传给后续计数逻辑，避免误触发更昂贵压缩。
Microcompact：专门清理过期工具日志，优先处理低价值、高体积的工具结果。
Context collapse：读时投影，把历史折叠成当前请求可用的视图，但不直接改写底层本地消息数组。
Auto-compact：最昂贵的全量重构，请 LLM 生成摘要边界并替换旧历史，只在前面几层无法回到安全水位时触发。

### 预算缩减
`persistReplacements`用于判断是否需要进行持久化，像是来自于agent和repl_main_thread的是需要才持久化，因为这些来源恢复时需要读回记录 临时的 agent 调用（如 agent_summary）不需要持久化
`messagesForQuery = await applyToolResultBudget`涉及到了两种压缩方式 一种是context内容上的压缩（applyToolResultBudget），一种是tool映射的结果来决定是否要压缩（cached microcompact）
为什么这很重要
因为 cached microcompact 的缓存机制是按 tool_use_id 建立映射的：
第一次运行: abc_123 → "保留" 的结果被缓存
如果 applyToolResultBudget 在 microcompact 之后运行，它修改了 content，但 tool_use_id 没变。microcompact 的缓存不会失效——缓存认为消息没变，但内容其实变了。
反过来，先运行 applyToolResultBudget（改内容），再运行 microcompact（按 ID 操作），microcompact 看到的 content 已经是裁剪过的，缓存就和实际内容一致了。

怎么推断需要压缩呢？因为会自动压缩的工具都会填上maxChars的字段，所以没填的例如读文件之类的操作就需要压缩了
注释里的那句话

  // For cached microcompact (cache editing), defer boundary message until after
  // the API response so we can use actual cache_deleted_input_tokens.

  意思是：缓存编辑不是立刻生效的，要等 API 响应回来，拿到实际的 cache_deleted_input_tokens（真正被删掉的 token
  数）之后，才更新缓存边界消息。这保证了缓存里的数据和实际情况一致。

  简单理解

  applyToolResultBudget → 改内容（不涉及缓存）
  cached microcompact   → 按 ID 做决策（决策结果缓存到磁盘）

  缓存 = microcompact 过去做的"保留/丢弃"决策记录，下次遇到同样的 tool_use_id 直接复用，不用重新算。

总的来说，工具结果预算先限制单个输出膨胀，避免 grep、日志、PDF 或搜索结果吞掉整轮窗口。

### Snip
```ts
if (feature('HISTORY_SNIP')) {
  messagesForQuery = snipCompactIfNeeded(messagesForQuery).messages
}
```
Snip 剪裁的是对话历史中间部分的消息内容。

  为什么是中间

  一段对话的历史可以分成三段：

  ┌──────────────┬───────────────────┬──────────────┐
  │   开头部分    │      中间部分      │   最近部分    │
  │  系统指令     │   工具调用/结果     │   当前上下文   │
  │  初始上下文   │   中间推理过程      │   最新消息    │
  └──────────────┴───────────────────┴──────────────┘
       不能动          可以剪裁          不能动

- 开头：系统指令、初始上下文，删了模型不知道自己是谁
- 最近：当前对话状态，删了模型不知道在干嘛
- 中间：大量工具调用结果、已经处理过的中间过程，是最大的 token 消耗者，但信息密度最低

具体剪裁什么

主要是旧的工具调用结果：

用户: 读一下 src/main.ts
模型: (调用 read_file)
结果: "import xxx\n..." (几千行代码)

用户: 这个文件有什么问题？
模型: (分析了一堆)

用户: 再读一下 src/utils.ts
模型: (调用 read_file)
结果: "function xxx..." (几千行代码)

... 过了很多轮 ...

用户: 帮我重构一下

此时中间那些 read_file 的结果已经没用了——模型早就消化过了。Snip 就是把这些旧的、已处理的大块内容删掉。

和其他压缩的区别

┌───────────────────────┬──────────────────────┬────────┐
│         方式          │       操作什么       │  粒度  │
├───────────────────────┼──────────────────────┼────────┤
│ applyToolResultBudget │ 单条工具结果的内容   │ 字段内 │
├───────────────────────┼──────────────────────┼────────┤
│ microcompact          │ 单条消息的保留/丢弃  │ 消息级 │
├───────────────────────┼──────────────────────┼────────┤
│ snip                  │ 一批旧消息的整体内容 │ 批次级 │
├───────────────────────┼──────────────────────┼────────┤
│ autocompact           │ 全部历史的摘要       │ 整体   │
└───────────────────────┴──────────────────────┴────────┘

  Snip 的特点就是批量清理旧内容，轻量、快速、不调用模型。

  boundaryMessage 的作用

  剪完之后，消息历史里会出现一个"空洞"：

  [消息1] [消息2] ... [空洞] ... [消息N-1] [消息N]

  boundaryMessage 就是插在空洞位置的一个标记，告诉模型：

  ▎ "从消息 X 到消息 Y 之间的内容已经被移除了，你可以假设它们发生过但不需要关注细节。"

  这样模型不会因为突然缺少上下文而困惑。
总的来说 对于很多工具的中间调用以及失败的尝试 作为一名十分合格的agent工程师，你必须需要去考虑中间上下文的管理，而snip就是上下文管理中的一环，给我的启示就是对于一些中间的例如工具调用的过程，为了成本以及模型效果考虑，需要我们人为去设计相关的管理机制
Snip 释放最旧历史，并把释放 token 数传给后续逻辑，减少重复压缩。
### microcompact
```ts
export async function microcompactMessages(
  messages: Message[],
  toolUseContext?: ToolUseContext,
  querySource?: QuerySource,
): Promise<MicrocompactResult>
```
这个是核心的函数头，接收完整消息列表、工具上下文、查询来源，返回压缩结果。
```
  // Time-based trigger runs first and short-circuits. If the gap since the
  // last assistant message exceeds the threshold, the server cache has expired
  // and the full prefix will be rewritten regardless — so content-clear old
  // tool results now, before the request, to shrink what gets rewritten.
  // Cached MC (cache-editing) is skipped when this fires: editing assumes a
  // warm cache, and we just established it's cold.
```
这个注释其实讲的挺详细的，这是一个基于时间来出发的压缩策略，主要是关于prompt的缓存，如果离开的时间比较长，缓存早就没了，再去做所谓的缓存操作是没有意义的
缓存编辑的前提是缓存还热着。如果缓存已经冷了（过期了），缓存编辑就没意义了——因为反正整个 prefix 都要重写。所以时间触发时跳过 cached MC，直接做暴力清空
```ts
if (feature('CACHED_MICROCOMPACT')) {
  const mod = await getCachedMCModule()
  const model = toolUseContext?.options.mainLoopModel ?? getMainLoopModel()
  if (
    mod.isCachedMicrocompactEnabled() &&
    mod.isModelSupportedForCacheEditing(model) &&
    isMainThreadSource(querySource)
  ) {
    return await cachedMicrocompactPath(messages, querySource)
  }
}
```
三个条件全部满足才走缓存编辑路径：

条件 1：isCachedMicrocompactEnabled()

功能是否全局开启。

条件 2：isModelSupportedForCacheEditing(model)

当前模型是否支持缓存编辑。不是所有模型都支持这个能力。

条件 3：isMainThreadSource(querySource)

只允许主线程执行。注释解释了为什么：

▎ Only run cached MC for the main thread to prevent forked agents (session_memory, prompt_suggestion, etc.) from registering their tool_results in the global cachedMCState

问题是：forked agent（比如后台的 session_memory、prompt_suggestion 任务）有自己的工具调用。如果让它们也注册到全局缓存状态里，主线程的缓存编辑会误删不存在的工具结果。

主线程:    toolu_abc → 注册到缓存状态 ✓
子 agent:  toolu_xyz → 不注册到全局缓存状态 ✗（防止污染）
总的来说是这么一个逻辑

```
  API 缓存还热吗？
    │
    ├── 已过期 → 暴力清空旧结果 → return
    │
    └── 还热 → 模型支持缓存编辑吗？
                │
                ├── 支持 + 主线程 → cached MC（增量编辑）→ return
                │
                └── 不支持 → 什么都不做 → return
                              │
                              └─ 后续 autocompact 兜底
```
Microcompact 面向老化工具结果，尤其是巨大但当前价值低的工具日志。
### Context collapse
把一组相关消息折叠成一个摘要，用一条消息替代原来的一堆消息。
```
    // Project the collapsed context view and maybe commit more collapses.
    // Runs BEFORE autocompact so that if collapse gets us under the
    // autocompact threshold, autocompact is a no-op and we keep granular
    // context instead of a single summary.
    //
    // Nothing is yielded — the collapsed view is a read-time projection
    // over the REPL's full history. Summary messages live in the collapse
    // store, not the REPL array. This is what makes collapses persist
    // across turns: projectView() replays the commit log on every entry.
    // Within a turn, the view flows forward via state.messages at the
    // continue site (query.ts:1192), and the next projectView() no-ops
    // because the archived messages are already gone from its input.
```
可以理解为在整个消息链路上，进行了一次投影，不改变原本的内容
Collapse 不往消息数组里插入新消息。它是一个只读投影——在读取时实时计算，不修改原始数据
```
  投影的时刻

  当需要发消息给模型时，实时计算：

  projectView(messages, collapseStore)
    │
    ▼
  遍历消息数组
    │
    ├── [0] system → 保留
    ├── [1] user → 保留
    ├── [2] assistant → 查 collapse store → 被折叠了 → 跳过
    ├── [3] tool_result → 查 collapse store → 被折叠了 → 跳过
    ├── [4] assistant → 查 collapse store → 被折叠了 → 跳过
    ├── [5] tool_result → 查 collapse store → 被折叠了 → 跳过
    ├── [6] assistant → 保留
    │
    ▼
  输出:
    [0] system
    [1] user
    [1.5] collapse_summary: "读了 src/ 和 package.json"
    [6] assistant
```
  在一个 turn 内：
  - 第一次 projectView() 计算折叠视图
  - 视图通过 state.messages 向前传递
  - 下一次 projectView() 发现旧消息已经被移除，不需要重新计算
### autocompact
这就是最狠的 让llm直接生成摘要的地方
```ts
  export async function autoCompactIfNeeded(
    messages: Message[],
    toolUseContext: ToolUseContext,
    cacheSafeParams: CacheSafeParams,
    querySource?: QuerySource,
    tracking?: AutoCompactTrackingState,
    snipTokensFreed?: number,
  ): Promise<{
    wasCompacted: boolean
    compactionResult?: CompactionResult
    consecutiveFailures?: number
  }>
```
如果真的是太大了无法压缩的话 那就直接断了，因为再这么下去也是浪费重试错误
```ts
if (
    tracking?.consecutiveFailures !== undefined &&
    tracking.consecutiveFailures >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES
  ) {
    return { wasCompacted: false }
  }
  // Circuit breaker: stop retrying after N consecutive failures.
  // Without this, sessions where context is irrecoverably over the limit
  // hammer the API with doomed compaction attempts on every turn.
```
用已经提取好的 session memory 文件作为摘要，替代传统压缩中"调用模型生成摘要"的步骤。
核心思路：对话过程中已经在后台持续提取关键信息存到 session memory 文件了，压缩时直接用这个文件当摘要，不用再调模型。
```ts
  const sessionMemoryResult = await trySessionMemoryCompaction(
    messages,
    toolUseContext.agentId,
    recompactionInfo.autoCompactThreshold,
  )
  if (sessionMemoryResult) {
    setLastSummarizedMessageId(undefined)
    runPostCompactCleanup(querySource)
    if (feature('PROMPT_CACHE_BREAK_DETECTION')) {
      notifyCompaction(querySource ?? 'compact', toolUseContext.agentId)
    }
    markPostCompaction()
    return {
      wasCompacted: true,
      compactionResult: sessionMemoryResult,
    }
  }
```
如果开启了自动总结类似的选项的时候 产生了session的总结 这个时候就直接先用这个了
```ts
  try {
    const compactionResult = await compactConversation(
      messages,
      toolUseContext,
      cacheSafeParams,
      true,          // Suppress user questions for autocompact
      undefined,     // No custom instructions
      true,          // isAutoCompact
      recompactionInfo,
    )

    setLastSummarizedMessageId(undefined)
    runPostCompactCleanup(querySource)

    return {
      wasCompacted: true,
      compactionResult,
      consecutiveFailures: 0,  // 成功，重置失败计数
    }
  } catch (error) {
    if (!hasExactErrorMessage(error, ERROR_MESSAGE_USER_ABORT)) {
      logError(error)
    }
    const prevFailures = tracking?.consecutiveFailures ?? 0
    const nextFailures = prevFailures + 1
    if (nextFailures >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES) {
      logForDebugging(
        `autocompact: circuit breaker tripped after ${nextFailures} consecutive failures`,
        { level: 'warn' },
      )
    }
    return { wasCompacted: false, consecutiveFailures: nextFailures }
  }
```
compactConversation就是llm直接生成对应的总结，最后最重的一环
也因为太重，模型通常会“断片”（忘记当前打开了什么文件、启用了什么技能）。因此，源码在压缩完成后设计了一个“重建阶段”，系统会自动将最近操作的最多 5 个关键文件（每文件限制 5K Tokens）和活跃的 Skill 指令作为附件重新注入回话流

总的来说这是一个渐进式的压缩过程

### 总结
压缩管线完整总结

  工具结果预算 → Snip → Microcompact → Context Collapse → Session Memory → Auto-compact
    （轻）───────────────────────────────────────────────────────────→（重）

  ---
1. 工具结果预算（applyToolResultBudget）

操作什么：单条工具结果的内容

怎么做：太长的内容替换成占位符 "..."
成本：极低，纯字符串操作
为什么先做：改内容，为后续按 ID 操作的 microcompact 准备好一致的数据

---
2. Snip

操作什么：一批旧消息的整体内容

怎么做：从对话中间部分批量删除已处理的旧内容
成本：低，不调模型
为什么要做：旧的工具结果是最大的 token 消耗者，但信息密度最低
关键点：释放的 token 数传给后续逻辑，避免重复压缩

---
3. Microcompact

操作什么：单条工具结果的保留/丢弃

怎么做：按 tool_use_id 做决策，决策可缓存
成本：低，增量操作
两种路径：
- 缓存热 + 模型支持 → 缓存编辑（最省）
- 缓存过期 → 暴力清空旧结果内容（快但粗暴）

---
4. Context Collapse

操作什么：一组相关消息

怎么做：把相关消息折叠成结构化摘要，存在独立 store 里
成本：低，不调模型
关键点：读时投影，不修改原始 REPL 数组，跨 turn 持久化
优势：保留分组关系，比 autocompact 更精细

---
5. Session Memory Compact

操作什么：整个对话历史

怎么做：用后台持续提取的 session memory 文件作为摘要，替换旧消息
成本：几乎为零，读文件
前提：有高质量的 session memory 文件
关键点：压缩后仍超阈值则回退到 auto-compact

---
6. Auto-compact

操作什么：整个对话历史

怎么做：调用模型生成摘要，替换所有消息
成本：最高，一次 API 调用
产物：compact boundary + post-compact messages
保护机制：熔断器防止无限重试
关键点：配合缓存复用和反遗忘重注入

---
一句话总结

┌──────┬──────────────────┬────────────────────┐
│ 层级 │       方式       │      核心思路      │
├──────┼──────────────────┼────────────────────┤
│ 1    │ 工具结果预算     │ 单条太长就截断     │
├──────┼──────────────────┼────────────────────┤
│ 2    │ Snip             │ 旧的批量删         │
├──────┼──────────────────┼────────────────────┤
│ 3    │ Microcompact     │ 按 ID 增量裁剪     │
├──────┼──────────────────┼────────────────────┤
│ 4    │ Context Collapse │ 相关的折叠成摘要   │
├──────┼──────────────────┼────────────────────┤
│ 5    │ Session Memory   │ 用现成笔记替代摘要 │
├──────┼──────────────────┼────────────────────┤
│ 6    │ Auto-compact     │ 调模型重写历史     │
└──────┴──────────────────┴────────────────────┘

核心原则：能在前面解决的就不到后面去。 前面的轻量操作能压到阈值以下，就不用调模型做重压缩。每一层各司其职，从轻到重，逐级降级。