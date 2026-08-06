---
layout: post
title: Claude code学习9 Agent loop
date: 2026-07-01 12:21:00 +0800
categories: [agent]
tags: [agent, claude-code, agent-loop]
giscus_comments: true
---

## agent loop

对于Claude code而言，agent loop是其核心 这也是所有agent的核心 决定其是否可以较为智能工作的一个核心

### query_loop

对于claude code而言，query_loop是其实现的核心代码
query loop的设计有许多值得学习的地方
第一，其不是普通的异步函数，而是async function* ，这是一个异步生成器函数，通过中间yield输出各种数据给其他接口使用，这样不会给用户或者使用者一个一直没有反馈的cli，而是有实时的信息反馈让用户可以判断当前的执行情况。
第二，yield 的对象不只是文本，还包括 StreamEvent、中间状态、工具摘要、墓碑消息和恢复提示，就是上面所说的各类数据
第三，对于一个需要运行长任务的agent loop而言，state状态的管理是极其重要的，对于Claude code而言，他把

```ts
let state: State = {
  messages: params.messages,
  toolUseContext: params.toolUseContext,
  maxOutputTokensOverride: params.maxOutputTokensOverride,
  autoCompactTracking: undefined,
  stopHookActive: undefined,
  maxOutputTokensRecoveryCount: 0,
  hasAttemptedReactiveCompact: false,
  turnCount: 1,
  pendingToolUseSummary: undefined,
  transition: undefined,
};
```

一些长任务必须的状态管理塞入了state里面，由于代码条件分支，很多时候莫名其妙改了忘记改回去或者说其他原因导致最后结果不一样，这个问题最好的解决问题就是用这种state打包状态，最后所有跨轮状态都要显式声明
总的来说，每次进入下一轮前，完整重建整个 State，而不是局部修改变量。这样每个分支都必须是自洽的状态跃迁，避免"改了 A 忘记改 B"的漂移问题。

transition 字段是 State 设计的点睛之笔

```ts
transition: {
  reason: "next_turn";
}
```

这个字段不直接影响运行，但有两个重要作用：

A. 调试和日志
当某轮行为异常时，看 transition.reason 就知道"上一轮为什么 continue"，不用翻消息内容。

B. 测试断言

测试可以检查：
expect(nextState.transition.reason).toBe('reactive_compact_retry')

而不用去比对复杂的 messages 数组。

### query() 与 queryLoop() 的关系

query() 是外层封装，queryLoop() 是内部状态机。

```ts
export async function* query(
  params: QueryParams,
): AsyncGenerator<..., Terminal> {
  const consumedCommandUuids: string[] = []
  const terminal = yield* queryLoop(params, consumedCommandUuids)
  for (const uuid of consumedCommandUuids) {
    notifyCommandLifecycle(uuid, 'completed')
  }
  return terminal
}
```

query() 做三件事：

1. 创建 consumedCommandUuids 数组；
2. 用 yield* 把 queryLoop 的事件流透明转发出去；
3. 等 queryLoop 正常返回后，统一通知消费的命令"已完成"。

拆成两层的原因：

- queryLoop 内部已经有 1700+ 行的复杂状态机，再把命令生命周期通知塞进去会严重增加复杂度；
- 命令开始是实时通知的，但完成通知 completed 必须等到整轮查询正常结束才发；
- 如果 queryLoop 抛异常或被 .return() 中断，completed 通知不会执行。

### State 字段与修改分支

State 的 10 个字段：

| 字段                         | 含义                           |
| ---------------------------- | ------------------------------ |
| messages                     | 当前对话历史                   |
| toolUseContext               | 工具上下文、abort 信号、选项   |
| maxOutputTokensOverride      | 临时输出 token 覆盖            |
| autoCompactTracking          | 自动压缩追踪状态               |
| stopHookActive               | stop hook 是否已激活           |
| maxOutputTokensRecoveryCount | 输出截断恢复计数               |
| hasAttemptedReactiveCompact  | 是否已尝试过 reactive compact  |
| turnCount                    | 当前轮数                       |
| pendingToolUseSummary        | 上一轮的 tool use 摘要 Promise |
| transition                   | 上一轮为什么 continue          |

7 个关键 continue sites：

| continue 点                | 位置          | 触发原因                             |
| -------------------------- | ------------- | ------------------------------------ |
| collapse_drain_retry       | query.ts:1115 | prompt-too-long → 提交已折叠上下文   |
| reactive_compact_retry     | query.ts:1165 | 轻量恢复失败或 media 错误 → 摘要压缩 |
| max_output_tokens_escalate | query.ts:1220 | 输出达到默认上限 → 升 64k            |
| max_output_tokens_recovery | query.ts:1251 | 64k 也满了 → 分段续写                |
| stop_hook_blocking         | query.ts:1305 | stop hook 要求修正后重试             |
| token_budget_continuation  | query.ts:1340 | 预算内继续生成                       |
| next_turn                  | query.ts:1727 | 正常进入下一轮                       |

关键观察：

- maxOutputTokensOverride 几乎总是重置为 undefined，只有 escalate 分支设为 ESCALATED_MAX_TOKENS；
- hasAttemptedReactiveCompact 在 stop_hook_blocking 分支里保持原值，不能重置为 false，否则会导致 compact → 仍然 413 → error → stop hook → compact 的死循环；
- turnCount 只在 next_turn 时递增，恢复路径不算新轮次；
- pendingToolUseSummary 只在 next_turn 传承，其他分支都重置为 undefined。

---

生命周期总览

```
[入口]
   ↓
[Pre-model 边界] ── 上下文组装、压缩、预算检查
   │
   ├── return: blocking_limit        (自动压缩关闭，上下文超过硬阻塞上限)
   │
   ├── continue: collapse_drain_retry (PTL → 折叠 drain)
   ├── continue: reactive_compact_retry (PTL/media → 摘要压缩)
   │
   ↓
[Model 边界] ── API 调用、流式响应
   │
   ├── continue: fallback retry      (模型 fallback，同请求重试)
   │
   ├── return: image_error           (图片处理错误)
   ├── return: model_error           (模型调用异常)
   ├── return: aborted_streaming     (用户中断流式响应)
   │
   ↓
[Post-model 边界] ── 响应已接收，无 tool_use 或 tool_use 待执行
   │
   ├── continue: max_output_tokens_escalate (默认上限 → 升 64k)
   ├── continue: max_output_tokens_recovery (64k 也满 → 分段续写)
   │
   ├── return: prompt_too_long       (PTL 恢复失败)
   ├── return: image_error           (media 恢复失败)
   │
   ├── continue: stop_hook_blocking  (stop hook 要求修正后重试)
   ├── return: stop_hook_prevented   (stop hook 决定终止)
   │
   ├── continue: token_budget_continuation (预算内继续生成)
   │
   ├── return: completed             (正常完成，无后续 tool_use)
   │
   ↓
[Tool 边界] ── 执行 tool_use 块
   │
   ├── return: aborted_tools         (用户中断工具执行)
   ├── return: hook_stopped          (hook 阻止继续)
   │
   ↓
[Post-tool 边界] ── 工具结果已收集
   │
   ├── return: max_turns             (达到最大轮数)
   │
   └── continue: next_turn           (正常进入下一轮)
```

一、Pre-model 边界：模型请求之前

这个阶段做 context assembly 和 compression。问题主要是上下文太大或压缩后需要重试。

```
┌────────────────────────────────┬───────────────┬─────────────────────────────────────────────────────┐
│               点               │     位置       │                    生命周期含义                       │
├────────────────────────────────┼───────────────┼─────────────────────────────────────────────────────┤
│ return { reason:               │ query.ts:646  │ 自动压缩关闭，上下文超过硬阻塞上限，无法继续。      │
│ 'blocking_limit' }             │               │                                                     │
├────────────────────────────────┼───────────────┼─────────────────────────────────────────────────────┤
│ continue                       │ query.ts:1115 │ prompt-too-long → 提交已折叠上下文，释放 token      │
│ (collapse_drain_retry)         │               │ 后重试。                                            │
├────────────────────────────────┼───────────────┼─────────────────────────────────────────────────────┤
│ continue                       │ query.ts:1165 │ 轻量恢复失败或 media 错误 → 完整摘要压缩后重试。    │
│ (reactive_compact_retry)       │               │                                                     │
└────────────────────────────────┴───────────────┴─────────────────────────────────────────────────────┘
```

设计思想：在真正花钱调用模型之前，先把上下文问题解决掉。从轻到重分层恢复。

---

二、Model 边界：API 调用期间

这是实际调用 Anthropic API 的阶段。问题主要是模型失败、fallback、用户中断。

```
┌───────────────────────────────────────┬───────────────┬──────────────────────────────────────────────┐
│                  点                   │     位置      │                 生命周期含义                 │
├───────────────────────────────────────┼───────────────┼──────────────────────────────────────────────┤
│ continue (fallback retry)             │ query.ts:950  │ 主模型触发                                   │
│                                       │               │ fallback，切换到备用模型重新请求。           │
├───────────────────────────────────────┼───────────────┼──────────────────────────────────────────────┤
│ return { reason: 'image_error' }      │ query.ts:977  │ 图片大小/缩放错误，无法继续。                │
├───────────────────────────────────────┼───────────────┼──────────────────────────────────────────────┤
│ return { reason: 'model_error', error │ query.ts:996  │ 模型调用抛异常，且不是可恢复错误。           │
│  }                                    │               │                                              │
├───────────────────────────────────────┼───────────────┼──────────────────────────────────────────────┤
│ return { reason: 'aborted_streaming'  │ query.ts:1051 │ 用户在模型流式输出时按 Ctrl+C。              │
│ }                                     │               │                                              │
└───────────────────────────────────────┴───────────────┴──────────────────────────────────────────────┘
```

设计思想：这个边界处理"模型本身"的问题。fallback retry 是内部重试，不进入新一轮；用户中断则立即终止并清理状态。

---

三、Post-model 边界：响应已收完，需要决定下一步

模型响应已经完整接收。这里分两种情况：

- 没有 tool_use → 评估各种恢复/终止条件；
- 有 tool_use → 进入 Tool 边界。

3.1 输出 token 相关

```
┌───────────────────────────────────────┬───────────────┬─────────────────────────────────────────────┐
│                  点                   │     位置      │                生命周期含义                 │
├───────────────────────────────────────┼───────────────┼─────────────────────────────────────────────┤
│ continue (max_output_tokens_escalate) │ query.ts:1220 │ 输出达到默认上限 → 同请求升 64k 重试。      │
├───────────────────────────────────────┼───────────────┼─────────────────────────────────────────────┤
│ continue (max_output_tokens_recovery) │ query.ts:1251 │ 64k 也满了 → 保留已输出内容，注入续写提示。 │
└───────────────────────────────────────┴───────────────┴─────────────────────────────────────────────┘
```

3.2 上下文错误恢复失败

```
┌──────────────────────────────────┬────────────────────┬─────────────────────────────────────────────┐
│                点                │        位置        │                生命周期含义                 │
├──────────────────────────────────┼────────────────────┼─────────────────────────────────────────────┤
│ return { reason:                 │ query.ts:1175 /    │ 所有 PTL 恢复手段耗尽，只能暴露错误。       │
│ 'prompt_too_long' }              │ 1182               │                                             │
├──────────────────────────────────┼────────────────────┼─────────────────────────────────────────────┤
│ return { reason: 'image_error' } │ query.ts:1175      │ media size 错误无法通过 reactive compact    │
│                                  │                    │ 恢复。                                      │
└──────────────────────────────────┴────────────────────┴─────────────────────────────────────────────┘
```

3.3 Stop hook 相关

```
┌────────────────────────────────────┬───────────────┬─────────────────────────────────────────────────┐
│                 点                 │     位置      │                  生命周期含义                   │
├────────────────────────────────────┼───────────────┼─────────────────────────────────────────────────┤
│ continue (stop_hook_blocking)      │ query.ts:1305 │ stop hook 认为需要修正 → 注入 blocking errors   │
│                                    │               │ 重试。                                          │
├────────────────────────────────────┼───────────────┼─────────────────────────────────────────────────┤
│ return { reason:                   │ query.ts:1279 │ stop hook 决定阻止继续（如检测到危险操作）。    │
│ 'stop_hook_prevented' }            │               │                                                 │
└────────────────────────────────────┴───────────────┴─────────────────────────────────────────────────┘
```

3.4 Token 预算

```
┌──────────────────────────────────────┬───────────────┬───────────────────────────────────────────┐
│                  点                  │     位置      │               生命周期含义                │
├──────────────────────────────────────┼───────────────┼───────────────────────────────────────────┤
│ continue (token_budget_continuation) │ query.ts:1340 │ 预算未耗尽且任务可能未完成 → nudge 继续。 │
└──────────────────────────────────────┴───────────────┴───────────────────────────────────────────┘
```

3.5 正常完成

```
┌────────────────────────────────┬───────────────┬─────────────────────────────────────────────┐
│               点               │     位置      │                生命周期含义                 │
├────────────────────────────────┼───────────────┼─────────────────────────────────────────────┤
│ return { reason: 'completed' } │ query.ts:1357 │ 模型正常响应完毕，没有 tool_use，可以结束。 │
└────────────────────────────────┴───────────────┴─────────────────────────────────────────────┘
```

设计思想：Post-model 边界是"决策点"。响应已经拿到了，系统要决定：是正常结束、恢复重试、还是被 hook 拦截。这个阶段的 continue 都不会增加 turnCount——它们是对同一轮的恢复/延续。

---

四、Tool 边界：执行工具期间

模型要求调用工具，系统开始执行。

```
┌────────────────────────────────────┬───────────────┬──────────────────────────────────────┐
│                 点                 │     位置      │             生命周期含义             │
├────────────────────────────────────┼───────────────┼──────────────────────────────────────┤
│ return { reason: 'aborted_tools' } │ query.ts:1515 │ 用户在工具执行期间按 Ctrl+C。        │
├────────────────────────────────────┼───────────────┼──────────────────────────────────────┤
│ return { reason: 'hook_stopped' }  │ query.ts:1520 │ 某个 hook 在执行过程中决定阻止继续。 │
└────────────────────────────────────┴───────────────┴──────────────────────────────────────┘
```

设计思想：工具执行可能耗时很长（比如跑测试、截图），所以单独设置中断边界。这里也会做 MCP 清理等收尾。

---

五、Post-tool 边界：工具执行完毕

工具结果已收集，准备进入下一轮。

```
┌───────────────────────────────────────────┬───────────────┬────────────────────────────────────────┐
│                    点                     │     位置      │              生命周期含义              │
├───────────────────────────────────────────┼───────────────┼────────────────────────────────────────┤
│ return { reason: 'max_turns', turnCount } │ query.ts:1711 │ 达到最大轮数限制，强制终止。           │
├───────────────────────────────────────────┼───────────────┼────────────────────────────────────────┤
│ continue (next_turn)                      │ query.ts:1727 │ 正常把工具结果回传给模型，进入下一轮。 │
└───────────────────────────────────────────┴───────────────┴────────────────────────────────────────┘
```

设计思想：这是每轮循环的"出口"。要么因为轮数限制终止，要么把本轮所有产出合并成新的 messages 继续循环。

### 关于 queryCheckpoint

queryCheckpoint 不是用于"备份和防止被打断"的，它主要是性能分析/埋点标记，不是恢复机制。

queryCheckpoint('query_api_loop_start')
queryCheckpoint('query_api_streaming_start')
queryCheckpoint('query_tool_execution_start')

这些 checkpoint 是在关键阶段打时间戳，用于：

- 测量每个阶段花了多久；
- 分析延迟瓶颈；
- 上报 telemetry 事件。

它们不参与恢复、不保存状态、不能防止中断。真正用于恢复的是 State 对象、transition 字段、yield 的消息序列、yieldMissingToolResultBlocks 等。

### 中断时消息是否持久化

会持久化，但不是 queryLoop 自己直接落盘，而是通过持续 yield 消息给外层，由外层写入 transcript / 会话状态。

中断处理的核心目标：让被中断这轮产生的消息仍然能构成一个合法、可恢复的对话历史。

query.ts:1015-1051：

- 如果 streamingToolExecutor 存在，消费 remaining results，生成合成的 tool_result；
- 否则 yield* yieldMissingToolResultBlocks，补齐缺失的 tool_result；
- 产出 createUserInterruptionMessage；
- return { reason: 'aborted_streaming' }。

Terminal 原因本身不会被持久化，但整个迭代过程中 yield 出去的消息序列会被外层记录，用于下一次对话。

### applyToolResultBudget

applyToolResultBudget 返回的是 Message[]，不是工具结果。

它的作用是：检查消息历史中每条工具结果的大小，如果超过预算，就把过大的内容替换成占位符/摘要，然后返回替换后的消息数组。

在 query.ts:379 的用法：

```ts
messagesForQuery = await applyToolResultBudget(
  messagesForQuery,
  toolUseContext.contentReplacementState,
  persistReplacements ? records => void recordContentReplacement(...) : undefined,
  new Set(toolUseContext.options.tools
    .filter(t => !Number.isFinite(t.maxResultSizeChars))
    .map(t => t.name)),
)
```

第三个参数 writeToTranscript 只在 persistReplacements 为 true 时传入，即 querySource 为 repl_main_thread* 或 agent:* 时。因为这两种来源的会话会被恢复，必须让 budget 系统在恢复后做出和原来一致的替换选择。

### 工具调度

对于agent的工具调用来说，他不是promise.all
原因有如下几个：
第一、不是所有工具都是并发的，并且也并不是所有看起来可以并发的工具都实际上可以并发，例如读文件这一个操作，如果同时读同一个文件或者一下读就读一大段，那么它的缓存就会特别大导致运行慢或者崩溃
第二，工具之间可能存在隐形依赖，创建文件夹和进入对应的文件夹就是很典型的一个例子，如果是没有先后顺序的话，那么就会出错
第三就是ui以及用户方面需要流式输出 promise all一次性给不合适

StreamingToolExecutor 用的是一个带并发控制的队列执行器。

ToolStatus：

```ts
type ToolStatus = "queued" | "executing" | "completed" | "yielded";
```

- queued：刚加入队列，等待执行；
- executing：正在执行；
- completed：执行完成，结果已收集但未产出；
- yielded：结果已经产出给外层。

并发控制规则（canExecuteTool）：

- 当前没有工具在执行 → 任何工具可以开始；
- 当前有工具在执行 → 新工具必须自己是并发安全的，且所有正在执行的工具也都是并发安全的。

也就是说：并发安全工具可以组成一组并行执行；但只要有一个非并发工具在执行，所有人都得等它。

StreamingToolExecutor 的关键方法：

- addTool：接收模型产生的 tool_use 块，加入队列；
- processQueue：根据并发规则调度执行；
- executeTool：真正执行单个工具，收集结果和进度；
- getCompletedResults：非阻塞地产出已完成结果和进度；
- getRemainingResults：阻塞等待所有工具完成；
- discard：streaming fallback 时丢弃所有待处理工具。

```ts
/**
 * Process the queue, starting tools when concurrency conditions allow
 */
private async processQueue(): Promise<void> {
  for (const tool of this.tools) {
    if (tool.status !== 'queued') continue

    if (this.canExecuteTool(tool.isConcurrencySafe)) {
      await this.executeTool(tool)
    } else {
      // Can't execute this tool yet, and since we need to maintain order for non-concurrent tools, stop here
      if (!tool.isConcurrencySafe) break
    }
  }
}
```

processQueue()的逻辑很简单，是queue的且可以并发的执行 其他的还是按照顺序执行

```ts
/**
   * Execute a tool and collect its results
   */
  private async executeTool(tool: TrackedTool): Promise<void> {
    tool.status = 'executing'
    this.toolUseContext.setInProgressToolUseIDs(prev =>
      new Set(prev).add(tool.id),
    )
    this.updateInterruptibleState()

    const messages: Message[] = []
    const contextModifiers: Array<(context: ToolUseContext) => ToolUseContext> =
      []

    const collectResults = async () => {
      // If already aborted (by error or user), generate synthetic error block instead of running the tool
      const initialAbortReason = this.getAbortReason(tool)
      if (initialAbortReason) {
        messages.push(
          this.createSyntheticErrorMessage(
            tool.id,
            initialAbortReason,
            tool.assistantMessage,
          ),
        )
        tool.results = messages
        tool.contextModifiers = contextModifiers
        tool.status = 'completed'
        this.updateInterruptibleState()
        return
      }

      // Per-tool child controller. Lets siblingAbortController kill running
      // subprocesses (Bash spawns listen to this signal) when a Bash error
      // cascades. Permission-dialog rejection also aborts this controller
      // (PermissionContext.ts cancelAndAbort) — that abort must bubble up to
      // the query controller so the query loop's post-tool abort check ends
      // the turn. Without bubble-up, ExitPlanMode "clear context + auto"
      // sends REJECT_MESSAGE to the model instead of aborting (#21056 regression).
      const toolAbortController = createChildAbortController(
        this.siblingAbortController,
      )
      toolAbortController.signal.addEventListener(
        'abort',
        () => {
          if (
            toolAbortController.signal.reason !== 'sibling_error' &&
            !this.toolUseContext.abortController.signal.aborted &&
            !this.discarded
          ) {
            this.toolUseContext.abortController.abort(
              toolAbortController.signal.reason,
            )
          }
        },
        { once: true },
      )

      const generator = runToolUse(
        tool.block,
        tool.assistantMessage,
        this.canUseTool,
        { ...this.toolUseContext, abortController: toolAbortController },
      )

      // Track if this specific tool has produced an error result.
      // This prevents the tool from receiving a duplicate "sibling error"
      // message when it is the one that caused the error.
      let thisToolErrored = false

      for await (const update of generator) {
        // Check if we were aborted by a sibling tool error or user interruption.
        // Only add the synthetic error if THIS tool didn't produce the error.
        const abortReason = this.getAbortReason(tool)
        if (abortReason && !thisToolErrored) {
          messages.push(
            this.createSyntheticErrorMessage(
              tool.id,
              abortReason,
              tool.assistantMessage,
            ),
          )
          break
        }

        const isErrorResult =
          update.message.type === 'user' &&
          Array.isArray(update.message.message.content) &&
          update.message.message.content.some(
            _ => _.type === 'tool_result' && _.is_error === true,
          )

        if (isErrorResult) {
          thisToolErrored = true
          // Only Bash errors cancel siblings. Bash commands often have implicit
          // dependency chains (e.g. mkdir fails → subsequent commands pointless).
          // Read/WebFetch/etc are independent — one failure shouldn't nuke the rest.
          if (tool.block.name === BASH_TOOL_NAME) {
            this.hasErrored = true
            this.erroredToolDescription = this.getToolDescription(tool)
            this.siblingAbortController.abort('sibling_error')
          }
        }

        if (update.message) {
          // Progress messages go to pendingProgress for immediate yielding
          if (update.message.type === 'progress') {
            tool.pendingProgress.push(update.message)
            // Signal that progress is available
            if (this.progressAvailableResolve) {
              this.progressAvailableResolve()
              this.progressAvailableResolve = undefined
            }
          } else {
            messages.push(update.message)
          }
        }
        if (update.contextModifier) {
          contextModifiers.push(update.contextModifier.modifyContext)
        }
      }
      tool.results = messages
      tool.contextModifiers = contextModifiers
      tool.status = 'completed'
      this.updateInterruptibleState()

      // NOTE: we currently don't support context modifiers for concurrent
      //       tools. None are actively being used, but if we want to use
      //       them in concurrent tools, we need to support that here.
      if (!tool.isConcurrencySafe && contextModifiers.length > 0) {
        for (const modifier of contextModifiers) {
          this.toolUseContext = modifier(this.toolUseContext)
        }
      }
    }

    const promise = collectResults()
    tool.promise = promise

    // Process more queue when done
    void promise.finally(() => {
      void this.processQueue()
    })
  }
```

三层 abort 控制器：

```
queryLoop 的 abortController          ← 用户中断整个查询
    ↓
siblingAbortController                ← Bash 错误时取消兄弟工具
    ↓
toolAbortController                   ← 单个工具的取消/权限拒绝
```

### Hook

Hook 是 Claude Code 生命周期中的"外部介入点"。主流程在特定时刻调用用户定义的 shell 命令，让用户在不修改 Claude Code 源码的情况下，实现安全检查、审计、通知、外部集成等自定义行为。

src/utils/hooks.ts 定义：

```
Hooks are user-defined shell commands that can be executed at various points
in Claude Code's lifecycle.
```

常见 hook 类型：

- StopHook：每轮模型响应后，检查并决定是否阻止继续；
- PreToolUseHook / PostToolUseHook：工具执行前后；
- PreCompactHook / PostCompactHook：压缩前后；
- SessionStartHook / SessionEndHook：会话开始/结束；
- FileChangedHook：文件变更时；
- TaskCreatedHook / TaskCompletedHook：任务创建/完成。

最典型的 StopHook 返回两种结果：

```ts
type StopHookResult = {
  blockingErrors: Message[];
  preventContinuation: boolean;
};
```

- preventContinuation: true → 直接结束本轮；
- blockingErrors → 把 hook 的反馈当作用户消息，让模型在下一轮修正。

### reactive_compact_retry

reactive_compact_retry 是 queryLoop 的被动压缩恢复路径。

触发条件：

- 模型返回 prompt-too-long；
- 且前面更轻的恢复手段（如 collapse_drain_retry）已经失败或不可用；
- 或者返回 media size 错误（图片/PDF 太大）；
- 且系统启用了 reactiveCompact 功能。

与 proactive autocompact 的区别：

- proactive：在调用模型之前就判断上下文是否太大，提前压缩；
- reactive：等错误发生了再压缩。

reactive_compact_retry 的处理：

1. 调用 reactiveCompact.tryReactiveCompact 对上下文做摘要；
2. 更新 taskBudgetRemaining；
3. 用 buildPostCompactMessages 构建压缩后消息；
4. 设置 hasAttemptedReactiveCompact: true 防止无限重试；
5. continue 回到循环顶部重新请求。

为什么需要 hasAttemptedReactiveCompact: true：
没有这个标记，可能陷入"请求 → 413 → reactive compact → 仍然 413 → reactive compact → ..."的无限循环。

### 只读不等于并发安全

只读操作仍然可能并发不安全，原因包括：

1. 共享缓存：并发大量读取不同大文件会互相驱逐缓存页，导致内存抖动；
2. 速率限制：外部 API 按请求次数限流，并发只读会共享配额；
3. 认证状态：多个并发请求同时发现 token 过期，会同时触发 token 刷新，导致竞态；
4. 外部系统副作用：读操作可能触发审计日志、计费、锁、缓存回填等。

因此 isConcurrencySafe 不是问"这个工具写不写文件"，而是问"这个工具在并发执行时，是否不会导致共享资源冲突、配额耗尽或竞态"。

### 显式 Planner vs 极简 Loop

显式 Planner 适合：

- 任务有明显的前置依赖关系；
- 需要长程规划和 replanning；
- 工具调用有复杂组合逻辑（如 map-reduce）；
- 需要人类预先审批计划。

极简 Loop + 厚边界适合：

- 交互式对话 / REPL；
- 工具调用相对独立；
- 流式体验要求高；
- 错误恢复路径多且细。

Claude Code 选择极简 Loop + 厚边界，因为核心场景是交互式编程助手：用户每次输入不可预测，响应需要实时流式，工具调用以文件/命令为主。

### 掌握 agent loop 的层次

Level 1：能讲清楚控制流；
Level 2：能追踪状态跃迁；
Level 3：能解释设计决策；
Level 4：能修改和扩展；
Level 5：能诊断复杂 bug；
Level 6：能设计新的 agent loop 架构。

最有效的练习：

1. 自己画一张 queryLoop 的完整状态图；
2. 追踪 hasAttemptedReactiveCompact 和 maxOutputTokensRecoveryCount 在每个 State 重建点的值；
3. 尝试改一个小东西，跑测试看会不会破坏。
