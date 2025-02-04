---
title: Simple RNN
date: 2025-02-04 21:09:00 +0800
categories: [Study, LLM]
tags: [study]
---
# Simple RNN
RNN在NLP领域中运用的背景
之前的神经网络例如卷积神经网络以及全连接神经网络都是输入输出长度相同的，但在文本问题上，输入输出可能是不同的，例如我让大语言模型写一首诗，他的回答就不可能是跟我问题一样长度的。因此，RNN被提出，它可以处理输入输出长度不同的问题。
同时呢，之前的神经网络是根据词来进行学习的，在之前提到的Apple公司和apple苹果的例子上，两者虽然单词相同但意思却不同，只是按照词来学习没有办法解决。
## RNN的结构


![alt text](/assets/2025-02-04-S1.png)


这是RNN的一个非常简化的一个结构，可以看到基本由三部分组成，状态，输入和参数，这里的矩阵A（参数矩阵）是不变的而状态h是会随着输入更新的。例如h1状态就是包含前面输入的the和cat的信息的状态


![alt text](/assets/2025-02-04-S2.png)


RNN的更新状态根据上一次的状态，不变的参数A以及当前的输入，通过激活函数tanh，得到当前的状态h。A矩阵有输入t个行，列的值是x和h的向量长度。
为什么激活函数是tanh呢？因为tanh函数的输出范围在-1到1之间，可以将输出范围缩小到0到1之间，使得状态更新的幅度更小。如果不这么做的话，假设t=100，输出的最后的状态就要乘以A^100，如果A大于1，则会是一个过大的值；如果A小于1，则会是一个过小的值，导致梯度消失或者爆炸。因此，tanh函数可以将输出范围缩小到0到1之间，使得状态更新的幅度更小。
```
rows = shape(h)
cols = shape(h) + shape(x)
```

RNN可以通过下列数学方程描述：
隐藏层状态：
\[ h_t = \sigma(W_{hh} \cdot h_{t-1} + W_{ih} \cdot x_t + b_h) \]

输出层状态：
\[ y_t = W_{ho} \cdot h_t + b_o \]
\( \sigma  是一个激活函数（如tanh或ReLU）， h_t  是当前隐藏状态，\)\( x_t  是当前输入， y_t  是当前输出。权重和偏置分别由 W_{hh}, W_{ih}, W_{ho}  和  b_h, b_o  表示。 \)

## 相关代码
```
from keras.models import Sequential
from keras.layers import SimpleRNN,Embedding,Dense

vocabular_size = 1000
Embedding_size = 32
word_num = 20
state_dim = 32

model = Sequential()
model.add(Embedding(vocabular_size,Embedding_size,input_length=word_num))
model.add(SimpleRNN(state_dim,return_sequences=False))
model.add(Dense(1,activation='sigmoid'))
model.summary()
```
上图搭建了一个简单的RNN模型，其中Embedding层将输入的词向量化，SimpleRNN层将输入的序列进行处理，输出最后一个隐藏状态，Dense层将隐藏状态映射到输出。

## RNN的缺点
simple RNN不擅长长文本内容，由于长文本循环次数多了，h的状态会与前面的状态几乎没有关系（导数几乎等于0），忘了，导致信息丢失。