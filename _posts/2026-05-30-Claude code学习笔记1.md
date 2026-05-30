---
title: Claude code学习
date: 2026-05-30 21:21:00 +0800
categories: [Study, agent]
tags: [study]
---
作为agent项目中可以说是最出名的一个项目，Claude code无疑是十分值得学习的项目。
最近我开始研究和使用cc，我觉得从使用的角度上无疑是十分好用的一个工具，现在我基本上要coding的话都会开着cc
而CC要学习的话，最好的一种方式肯定就是阅读源码了
从阅读源码的角度上来讲，我参考了
`
https://github.com/Perhacept/claudecode-analysis
`
的阅读顺序，我觉得这个作者写的十分不错，从agent编程的角度上来讲，直接讲和看源码绝对是比把一些复杂的概念直接跟你说是有意义的。
Harness工程是今年开始火的一个词，总的来说就是我们需要用软件工程的角度上去解决大语言模型基础的agent的一些问题，就例如幻觉一类的问题，我们当然无法影响他的QKV使得其可以幻觉消失，而是默认它本身的行为就是不可靠的，在它不可靠的时候进行兜底，这是我们作为一个所谓agent开发应该拥有的一个思路

所以对于我们开发的时候而言，最重要的一环其实并不是说我们去调用一个api接口，或者换句话说，学习Claude code源码更应该关注的是它为了减小模型的幻觉，他在软件工程这个方面做了哪些努力。

上面这个项目是十分好的阅读材料，我会写一些关于我自己的见解在博客上，这里引用一下仓库作者说的话
```
源码阅读的三问：这段代码如何控制模型能看见什么？它如何限制模型能做什么？失败、超限或恢复时，它如何把系统带回可继续状态？
```
这里先以query loop讲讲整个的例子（我本人也并不是很熟悉ts...）
这里是query loop的代码节选,query loop在/src/query.ts里，首先先看看定义了些什么
```ts
  QueryParams — 每次用户对话带进来的全部装备

  type QueryParams = {
    messages: Message[]              // 完整对话历史
    systemPrompt: SystemPrompt       // 系统提示词（工具描述、规则等）
    userContext: { [k: string]: string }   // 用户级别的上下文变量
    systemContext: { [k: string]: string } // 系统级别的上下文变量
    canUseTool: CanUseToolFn         // 权限判断函数
    toolUseContext: ToolUseContext    // 工具运行环境（包含所有工具定义、选项等）
    fallbackModel?: string           // 备用模型（主模型过载时切换）
    querySource: QuerySource         // 调用来源（repl / agent / sdk 等）
    maxOutputTokensOverride?: number // 输出 token 上限覆盖
    maxTurns?: number                // 最大轮数限制
    skipCacheWrite?: boolean         // 是否跳过缓存写入
    taskBudget?: { total: number }   // API task_budget（总预算）
    deps?: QueryDeps                 // 依赖注入（方便测试 mock）
  }
```
可以看到这里面除了我们最常见的聊天的message prompt一类的信息，还有一些有关于服务甚至于兜底的备用模型的选项，这里面更多是一些有关于产品方面的设计
```ts
  type State = {
    messages: Message[]                              // 当前消息列表（每轮更新）
    toolUseContext: ToolUseContext                    // 工具上下文（可能被工具执行更新）
    autoCompactTracking: AutoCompactTrackingState     // 自动压缩的追踪状态
    maxOutputTokensRecoveryCount: number              // 输出截断恢复次数（防止死循环）
    hasAttemptedReactiveCompact: boolean              // 是否已尝试过响应式压缩
    maxOutputTokensOverride: number | undefined       // 动态调整的输出上限
    pendingToolUseSummary: Promise<...> | undefined   // 上一轮的工具摘要（异步生成）
    stopHookActive: boolean | undefined               // 停止钩子是否激活
    turnCount: number                                 // 当前轮数
    transition: Continue | undefined                  // 上一轮为什么继续（调试/测试用）
  }
```
这是关于状态的设计，可以看到，这里面有许多关于限制agent以及管理上下文的相关配置，这些配置用来限制agent，防止其例如无限次的运行，或者一次性上下文太大
agent并不是所谓的模型给的越大越好，作为一个agent的系统，一般一开始agent的效果是最好的，因为最一开始上下文是最干净的，系统的熵也是最小的，想要agent效果好，适当的做减法减少熵增是十分重要的，从对话层面上来讲压缩上下文是好的·

```ts
async function* queryLoop(params, consumedCommandUuids) {
  const { systemPrompt, userContext, canUseTool, maxTurns } = params
  let state = {
    messages: params.messages,
    toolUseContext: params.toolUseContext,
    turnCount: 1,
    hasAttemptedReactiveCompact: false
  }
  using pendingMemoryPrefetch = startRelevantMemoryPrefetch(
    state.messages, state.toolUseContext
  )
  while (true) {
    const { messages, turnCount } = state
    // 每轮读 state，产生消息、工具结果或恢复动作
  }
}
```
每轮做一件事：调模型 → 看模型要不要调工具 → 调了就把结果塞回 messages → 继续下一轮。

  第1轮: 用户消息 → 模型回复(含tool_use) → 执行工具 → 拿到结果
  第2轮: 上面全部 + 工具结果 → 模型回复(含tool_use) → 执行工具 → 拿到结果
  第3轮: 上面全部 + 工具结果 → 模型回复(纯文字，无tool_use) → 结束

  state 的 messages 字段每轮增长，直到模型不再调工具，循环退出。

  一句话：queryLoop = 带状态的消息膨胀循环，模型和工具交替执行，直到模型说"我做完了"。

```
  query(params)
    └─ yield* queryLoop(params)
         │
         ├─ 初始化 state
         ├─ 启动内存预取
         │
         └─ while(true) {
              │
              ├─ ① 上下文压缩管线
              │   ├─ applyToolResultBudget (裁大结果)
              │   ├─ snip (裁旧消息)
              │   ├─ microcompact (微压缩)
              │   ├─ collapse (折叠)
              │   └─ autocompact (自动摘要)
              │
              ├─ ② Token 阻塞检查 → 超限则退出
              │
              ├─ ③ 调用模型 API（流式）
              │   ├─ 逐条接收 assistant 消息 → yield
              │   ├─ 收集 tool_use 块
              │   ├─ 流式工具执行（边收边执行）
              │   └─ 错误恢复（模型回退）
              │
              ├─ ④ needsFollowUp?
              │   ├─ false → 错误恢复（PTL/MOT）→ stop hooks → return
              │   └─ true → 继续
              │
              ├─ ⑤ 执行剩余工具
              │   ├─ runTools() 或 streamingToolExecutor.getRemainingResults()
              │   └─ yield 工具结果
              │
              ├─ ⑥ 收尾
              │   ├─ 生成工具摘要（后台）
              │   ├─ 中断检查
              │   ├─ 注入附件（文件变更、内存、技能）
              │   ├─ 刷新工具列表（MCP）
              │   └─ 最大轮数检查
              │
              └─ ⑦ state = { messages: [...旧消息, ...assistant, ...工具结果] }
                   continue → 回到 while(true) 顶部
            }
```
总而言之，就是在agent loop中，你会遇到很多情况，例如用户的ctrl c，亦或者是工具的返回有问题，模型出现幻觉导致没有满足用户的需求但是输出了，这些都需要有工具托底，模型能力是模型能力，你写的代码能不能托底考的是工程能力

