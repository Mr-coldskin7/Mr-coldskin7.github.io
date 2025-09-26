---
title: 如何理解transformer
date: 2025-09-26 17:21:00 +0800
categories: [Study, attention]
tags: [study]
---
如何正确以及完整理解transformer是一件困难的事情，表述能力的不同，观众也会听到完全不一样的理解，这里谈谈我的理解

解决的问题：卷积神经网络对于比较长的序列比较难以建模
像之前的RNN或者说是LSTM，就拿RNN举例，上一个的输出当作下一个的输入，序列一长自然就会遗忘，那怎么样才能解决遗忘呢，就好比人类读句子一样，我们理解句子不应该是一个词一个词的读，而是一段话一段话的读，好比英语阅读中的提取句子主干一样

![alt text](/assets/image-15.png)

## encoder-decoder
Transformer 模型本身是 Encoder-Decoder 结构
encoder 输入一个n长度的序列，decoder解码出一个长度为m的序列，encoder里面的词是可以一次性看的，decoder里面的词是一个一个生成的
过去时候的输出也可以作为当前时刻的输入，这种叫做自回归
encoder：重复六层，每一层又有两个子层，第一个是多头注意力机制，第二个可以看作是一个MLP
对于每一个子层，用了残差链接

## layer normalization
不同于batch normalization
假设输入数据的形状是 [N,C,H,W]，其实就是在哪一个维度来计算均值和方差
对于layer normalization来说 是对第N个样本进行计算的，对于每个样本 n，LN会计算该样本在所有特征（即 C×H×W）上的均值和方差
对于batch normalization来说，是对第C个通道进行计算的，BN是在小批量（batch）维度上对每个通道（channel）进行归一化，对于每个通道 c，BN会计算该通道在所有样本 N 上的均值和方差
BN在NLP中表现不佳的核心原因是：​​同一个batch内不同序列的长度可能不同（需要padding），且同一位置的字符在语义上没有相关性​​。BN的统计量（均值、方差）会因为padding和序列的语义独立性而变得非常不稳定。LN对每个序列独立计算，完美避免了这个问题。

## multi-head attention
为了解决在预测t时刻的输出时，解码器不应该看到t时刻之后的输入，所以有masked multi-head attention
如何理解multi-head attention呢
应该这么理解，通过线性把q，k，v映射到一个新的语义空间，然后用scaled dot-product attention，也就是我们熟知的注意力机制，最后concat形成output

## masked multi-head attention
在decoder输出的时候不想要看到后面要输出的内容，所以需要masked把这些全部转换成0

## scaled dot-product attention
![alt text](/assets/image-16.png)

\[
\text{Attention}(Q, K, V) = \text{softmax}\left(\frac{QK^T}{\sqrt{d_k}}\right)V
\]

要理解这个公示 主要要解一个问题
### 1. Q,K,V？
从机器学习的角度看，Q（Query）、K（Key）、V（Value）的设计灵感更可能来源于​​信息检索系统​​：你用Query去Key的数据库里检索，然后返回对应的Value。
你也可以从符号学的角度来理解
如果从哲学层面上来讲，跟拉康符号学有关

能指（Signifier）：符号的物质形式（如语音、文字） 所指（Signified）：符号引发的心理概念 意义（Meaning）：通过能指链的差异关系动态生成

更精确的类比则是Q/K 构成能指网络，它们如同符号系统中的能指，本身没有固定意义，但通过彼此的差异关系（点积相似度）生成注意力权重——这对应拉康所说的「能指通过差异产生意义」。

V 是所指的沉淀层，Value 矩阵承载被社会/模型「规训」过的符号意义（如训练数据中的语义关联），但它的显现方式受 Q/K 动态调节——如同所指并非固定，而是被能指网络临时锚定。

注意力权重是「缝合点」 权重分配如同拉康的「缝合点」（point de capiton），将浮动的能指（Q/K）暂时固定到具体的所指（V）上，生成临时的意义结构。

机器与人类符号系统有着的深层共性：意义并非存在于孤立的符号中，而是通过关系网络动态构建的。人类语言中，”树”的意义由它与”森林”、”年轮”、”氧气”等符号的差异关系决定。模型中，一个单词的语义由它与上下文词的注意力交互决定。这种设计让模型摆脱了静态的词嵌入表示，实现了类似人类语言的语境敏感性（context-sensitive meaning）。

回归公式，Q,K,V矩阵都是由输入进过embedding层映射到高维之后乘以训练后的参数矩阵得到 QK^T矩阵是相似度的计算，这里的计算是算内积（或者叫点乘） 为什么要除以根号d？d是k的维度，论文中提到如果直接计算点乘会导致整个数值特别大，会使得梯度消失；前半个是相似度的计算，后半部分乘以V是代表的实际的内容
> quote 我之前写过的内容 https://mr-coldskin7.github.io/posts/Attention2/
> https://mr-coldskin7.github.io/posts/Attention/

大白话来讲就是softmax求相似程度，乘以value得到值

## Position-wise Feed-Forward Networks
它的本质就是一个MLP多层感知机，标准的线性层 -> 激活函数 -> 线性层​​
他对每一个词作用一次（同一个MLP）
你需要理解前面的attention主要在做什么，他是相当于把信息抓取出来以及聚集了，我想要映射到我更想要的语义空间上，FFN需要做的就是这个
FFN 的作用是对 Self-Attention 层输出的、已经融合了全局信息的每个位置的表示，进行进一步的非线性变换和升维/降维，以增加模型的表达能力和非线性。它可以理解为对每个“单词”的特征进行“精加工”

## Positional Encoding
语序对于语义空间的影响还是较大的，attention本身不带有时序或者序列信息，所以需要添加对应的内容
\[ PE_{(pos,2i)} = \sin\left(\frac{pos}{10000^{2i/d_{\text{model}}}}\right) \]

\[ PE_{(pos,2i+1)} = \cos\left(\frac{pos}{10000^{2i/d_{\text{model}}}}\right) \]
里面是这样做的，直接把时序内容加进语义内容里面
这件事怎么理解呢？应该把query和key看作两个向量，有两个维度，一个是语义信息，一个是时间序列，点乘综合了二者作为基向量的时候q和k的大小，所以在影响语义信息较小的情况下实现了时序