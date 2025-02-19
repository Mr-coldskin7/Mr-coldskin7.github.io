---
title: Attention注意力机制
date: 2025-02-19 16:00:00 +0800
categories: [Study, LLM]
tags: [study]
---
# Attention注意力机制
在正式聊到attention之前，先来讲讲为什么需要attention机制。
## seq2seq模型的弊端
我们知道，seq2seq模型是一种典型的encoder-decoder模型，模型通过Encoder将输入序列编码为固定长度的上下文向量（Context Vector），再由Decoder生成输出序列。这种架构存在两个关键问题但是，seq2seq会遗忘当输入的序列过长的时候，会有两种问题
一是长序列遗忘：当输入序列过长时（如超过30个词），上下文向量难以完整保留所有信息，即便使用LSTM/GRU，长距离依赖仍会衰减。
二是信息对齐缺失：Decoder每一步生成输出时，均使用相同的上下文向量，无法动态关注输入序列中与当前输出最相关的部分。
即使是long short-term memory (LSTM) 这样的RNN结构，它有一条长记忆以及短记忆来进行信息的存储。但是，当输入序列过长时，LSTM仍然会遗忘
我们人类读一些长句子同样也有这方面的问题，所以我们可以像我们人类一样引入注意力机制，人类阅读长文本时，会通过反复回看（Refocus）关键片段辅助理解，而非一次性记忆全部内容。
## 将Attention机制加入编码解码器
主要来说，注意力机制的核心是为每一个输入增加一条额外的路径让解码器可以直接访问
注意力机制需要计算编码层以及解码层输出之间的相似性，一般使用cos来使用


![alt text](/assets/2025-02-19-P1.png)


计算两个词之间的相关性后，我们希望数值较大的那个词对于编码器输出的第一个词有更大影响


![alt text](/assets/2025-02-19-P2.png)


我们将这些首先进过softmax函数
>Softmax是一种激活函数，它可以将一个数值向量归一化为一个概率分布向量，且各个概率之和为1。Softmax可以用来作为神经网络的最后一层，用于多分类问题的输出。Softmax层常常和交叉熵损失函数一起结合使用。


![alt text](/assets/2025-02-19-P4.png)


来进行归一化，我们可以将softmax函数的输出看作是我们应该在每个编码后输出单词的百分比


![alt text](/assets/2025-02-19-P3.png)


我们将百分比与对应的数值相加以后求和，这个求和后的数就是关于相关的词的注意力值
现在我们只需要把这些注意力值全部输入到全连接层，并将这个相关的词也输入到同一个连接层，再将输入出来的值通过softmax函数进行归一化，选出概率最大的
## 注意力机制的核心思想
动态权重分配
注意力机制的核心是为每个解码时刻动态分配不同的权重，聚焦输入序列中与当前输出最相关的部分。其核心组件包括：

Query（查询向量）：来自Decoder的当前状态，表示“当前需要关注什么”。

Key（键向量） 和 Value（值向量）：来自Encoder的隐藏状态，Key用于计算与Query的相关性，Value是实际参与加权求和的信息。

计算步骤（以缩放点积注意力为例）
相似度计算：通过Query与每个Key的点积衡量相关性（可替换为加性注意力等）。

Score(Q,Ki)=Q⋅Kidk(缩放避免梯度消失)
权重归一化：对相似度得分进行Softmax，得到注意力权重分布。
αi=Softmax(Score(Q,Ki))
上下文向量生成：加权求和Value向量，得到聚焦后的上下文信息。
Context=∑iαiVi
缩放点积注意力计算流程

注意力机制的类型
1. 自注意力（Self-Attention）
特点：Query、Key、Value均来自同一序列（如Transformer中的Encoder）。

作用：捕捉序列内部的长距离依赖关系，解决RNN的逐步传递信息丢失问题。

2. 交叉注意力（Cross-Attention）
特点：Query来自Decoder，Key和Value来自Encoder（如机器翻译中Decoder关注源语言序列）。

作用：实现输入与输出的动态对齐，替代传统Seq2Seq的静态上下文向量。
```
import torch
import torch.nn.functional as F

def self_attention(Q, K, V):
    d_k = Q.size(-1)
    scores = torch.matmul(Q, K.transpose(-2, -1)) / torch.sqrt(torch.tensor(d_k))
    weights = F.softmax(scores, dim=-1)
    return torch.matmul(weights, V)

# 输入：batch_size=2, seq_len=3, embedding_dim=4
Q = torch.randn(2, 3, 4)
K = V = Q  # 自注意力
output = self_attention(Q, K, V)
```