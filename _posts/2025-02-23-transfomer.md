---
title: Transformer
date: 2025-02-23 23:00:00 +0800
categories: [Study, LLM]
tags: [study]
---
# Transformer
## Encoder层
transformer的encoder层可以使用RNN或者CNN


![alt text](/assets/20250223image.png)


为了简化上面的，我们可以先从一个较为简单的入手


![alt text](/assets/20250223image-1.png)


可以看到，encoder可以看作有很多的block层组成，而block层可以看作将输入经过self-attention层后输出的内容经过全连接层后输出的结果


![alt text](/assets/20250223image-2.png)


细看的话，经过self-attention的输出需要与其输入进行residual connection（残差连接）Output=LayerNorm(x+Sublayer(x))，其中Sublayer(x)是self-attention层的输出，而LayerNorm是对输出进行归一化的操作。
> 残差连接的作用
>缓解梯度消失:深层网络中，梯度在反向传播时可能逐渐消失。残差连接通过“短路路径”直接传递梯度，使深层参数更容易更新。保留原始输入信息即使子层（如自注意力）的更新不够理想，输入信息仍能通过残差连接保留，避免信息丢失。
>加速收敛:实验表明，残差连接能显著加快模型训练速度。

Layer Normalization（层归一化）
你可以把他看作对于输入的一个归一化从这个输出层的角度来讲，其计算方式也及其类似于概率论里面的标准化
>假设某一层的输出值范围差异很大（例如某些神经元输出为 100，某些为 0.1），这会导致后续层的计算不稳定。LayerNorm 将所有神经元的输出“压缩”到均值为 0、方差为 1 的分布，再通过可学习的 γ 和 β调整到合适的范围。
我们再把这个Layer Normalization的输出再经过一次全连接层后进行残差连接，最后可以得到transformer里面一个block的输出
> 为什么要加上原来的输出呢，这样可以解决了网络退化问题，至少说加上之前的输入，我的模型不会更差
## Decoder层


![alt text](/assets/20250223image-3.png)


在transformer的decoder层预测时，其实是类似于RNN的，但又有所不同。
他首先先接受一个开始信号（BOS）开始对encoder的输出进行回应，然后在根据前文的内容输出信息。
不同阶段decoder层接受的方式不一样
如果是训练时，解码器接收完整的目标序列（例如翻译后的整个句子），但通过 掩码机制（masked self-attention）确保每个位置的预测仅依赖于之前的输出。
如果是预测的时候，它会像rnn一样，接受输入以及前面输出的信息，解码器逐步生成序列，每一步的输入是上一个生成的token。
decoder层的结构与encoder层类似，但是多了一个masked self-attention层，我们不希望前面的输出能看到后面的内容后再决定
输出的信息也需要经过softmax转换为类似于概率分布的形式，选择概率最高的作为下一个token的预测


![alt text](/assets/20250223image-4.png)


例如上图的b2的attention计算，我们只计算a1，a2的相似度而不去计算超过b2的位置的相似度，这样可以防止信息泄露。
我们添加EOS让整个系统停下，要不然他会一直工作下去
Decoder又分为AT decoder和NAT decoder


![alt text](/assets/20250223image-5.png)


AT decoder是像上文所讲的一样，直到生成EOS为止，每一步都接受encoder的输出以及上一步的输出后进行下一步的预测。
而NAT decoder则是只接受encoder的输出，它的停止方式比较古怪，第一种是你可以训练一个模型来告诉它应该输入的长度是多少，又或者等它自己编不下去
这样做的好处就是第一输出是平行的，而且速度上更快
不过NAT decoder的缺点是生成的结果有点可惜，需要比AT decoder多花很多精力

## Encoder-Decoder


![alt text](/assets/20250223image-6.png)


这里跟attention的计算方式十分类似，decoder里面的查询与encoder里面的key计算相似度（a’，当然这里需要标准化）然后乘以encoder的value，加起来后送入一个全连接层，这上面的操作也叫交叉注意力（cross attention）
## 训练


![alt text](/assets/20250223image-7.png)


可以看到，我们希望我们输出的结果的概率分布与目标序列的概率分布尽可能的接近（其实就是独热编码），我们需要最小化其中的交叉熵
需要记得最后需要输出EOS，其输出的概率分布也应该接近EOS的独热编码
可以观察到，在训练的时候decoder的输入输出其实可以看作是几乎一样的（除了BOS和EOS）这种叫做teacher focusing，让模型训练的时候接收到的就是正确的答案