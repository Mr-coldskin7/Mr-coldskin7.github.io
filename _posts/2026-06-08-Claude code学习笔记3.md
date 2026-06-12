---
title: Claude code学习3
date: 2026-06-08 22:21:00 +0800
categories: [Study, agent]
tags: [study]
---
## 三条物理暗线：缓存、防幻觉、错误扣留
### 缓存
这里的缓存指的是KV cache一类的在api服务商的缓存，如果你有留意到llm的api key的收费的话，缓存命中跟不命中相差的价格是差别很大的
所以，要做一个合格的大语言模型，是需要考虑到成本和KV cache的，要不然的话使用你的agent比其他的完成相同的任务更省钱，谁还愿意用你的服务呢？这一点是我之前没有考虑过以及思考到的，今天算是学到了
所以从一个agent系统设计的角度上来看，理解KV cache以及如何设计一个更符合KV cache的agent系统，是十分重要的核心技能
```
缓存第一性原理：Prompt Cache 依赖字节级前缀匹配。内置工具 A-Z 排序并固定在 MCP 工具之前、System Prompt 动静分界、动态时间和 Git 状态用 <system-reminder> 注入、microcompact 通过 cache_edits 旁路删除，目的都是死保昂贵前缀。
```
Cached MC = 不在本地改数据，把"删哪些/留哪些"的指令发给 API，让 API 在缓存层执行。 本地和缓存各管各的，互不干扰。
### 对抗 LLM 固有缺陷
```
系统默认不信任模型记忆。FileEditTool 写前必须证明存在当前文件的 readFileState；Auto/YOLO 分类器连续拒绝会熔断，防止模型换语法反复试探；验证 Agent 必须给出实际测试输出，而不是一句看起来没问题。
```
从工具的设计角度上也能十分看出这一点，例如改文件的工具，普通的或者没有特别多经验的小白可能就随便写一个工具就完成了，但是在cc里面他是长这样的
```ts
const readTimestamp = toolUseContext.readFileState.get(fullFilePath)
if (!readTimestamp || readTimestamp.isPartialView) {
  return { result: false, behavior: 'ask', message: 'Read it first' }
}
if (lastWriteTime > readTimestamp.timestamp && fileContent !== readTimestamp.content) {
  return { result: false, behavior: 'ask', message: 'Read it again' }
}
const actualOldString = findActualString(file, old_string)
if (!actualOldString) return { result: false, behavior: 'ask' }
if (matches > 1 && !replace_all) return { result: false, behavior: 'ask' }
```
首先需要检查有没有读过这个文件，其次要检查读的时间和上次修改的时间，后检查自己要替代字符串是否存在，最后更是检查自己是不是要全部替代所有的相关字符串，可以看到，光修改一个文件其实就有这么多的限制
### 灾难恢复与错误扣留
这很好理解，没有人想用一个用一会就报错中断的程序，不同于平常的Saas软件系统或者其他软件，他们的代码相对固定，不像llm有这么大的变数，所以作为一个llm为驱动的系统，他需要有错误处理机制
遇到 413、媒体过大或输出截断时，系统会先扣留可恢复错误，后台触发 context collapse、reactive compact 或局部剥离，再带着重试标记重新入模。中间错误过早外抛，会让 SDK、桌面端或远程桥接直接终止会话。
并且错误扣留线让长任务不会因为一次可恢复 API 异常直接崩溃。
## 一切的铺垫都是为了可持续
可持续就是一句话，这个系统加上了概率输出的llm后，怎么样可以持续运行长任务，怎么样可以让api调用更加便宜一点，怎么样在大的项目里面持续运行
```
长上下文越完整，成本、延迟、缓存失效和恢复失败概率越高；工具越强，权限、并发和审计压力越大；子 Agent 越多，目标漂移和上下文污染风险越高。

五层压缩流水线就是典型的成本阶梯：Budget Reduction 先做零模型成本的工具结果裁剪；Snip 做轻量历史截断；Microcompact 对齐缓存块；Context Collapse 做读时虚拟投影；Auto-compact 最后才调用模型做语义摘要。顺序不能随意调换，因为越靠后越贵、越慢、越可能丢细节。

工程妥协还体现在很多局部规则里：子 Agent 只向父级返回 summary，是用细节透明度换父会话上下文带宽；重量级工具先以 stub 暴露，是用一次 ToolSearch 换首轮前缀瘦身；动态 Git 状态不进 System Prompt，是用尾部提醒换静态缓存命中。

看见复杂排序、边界 marker、旁路删除、缓存断点、fork 前缀复用时，先问它是否在保护一个昂贵稳定前缀。Prompt Cache 不是锦上添花；在长会话和大规模用户下，它决定系统是否付得起、是否足够快、是否能在 200K 级上下文里持续工作。
```
这里引用参考项目https://github.com/Perhacept/claudecode-analysis的一段话，我觉得很有学习价值
无论是在缓存做文章，还是在prompt里面动静分明，还是在做错误兜底，核心都是为了让系统稳定且可持续化

同时，注意！！！！！！
未来的模型必定是比现在的模型上下文更长，注意力更加，输出更准确的，目前的复杂是为了兼容现在，系统不能为了复杂而复杂
