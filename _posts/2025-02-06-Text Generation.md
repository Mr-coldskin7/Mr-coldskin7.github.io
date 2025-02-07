---
title: Text Generation
date: 2025-02-07 23:54:00 +0800
categories: [Study, LLM]
tags: [study]
---
# Text Generation
RNN可以进行文本生成（显而易见，这需要训练），其具体的判断方法跟概率论有关，例如下图选择最大几率的下一个字符


![alt text](/assets/2025-02-07-S1.png)


我们得到下一个词以后把概率最大的加入到字符串中，再把新字符串当作输入，继续生成下一个词，直到达到指定长度。
那我们该怎么训练这样的RNN呢？
## 训练
首先我们需要对文本切片，切成一个个segment
我们需要指定输入的切片长度以及移动的步长stride，将想要预测的内容进行标签化，标签化的目的是为了让RNN知道哪个词是我们想要预测的，如下图，蓝色的字符就是我们想要训练的


![alt text](/assets/2025-02-07-S2.png)


训练数据就是这些蓝色label以及红色的segment的pair
RNN生成的数据具有创造性，他不仅仅是只是对以前学习过的内容进行重复，而是会生产意想不到的新内容
我们训练时文章像是这样就能生成许多对训练数据，这个时候我们需要把他们转换成编码。首先我们要先建立一个字典进行相对应的映射，映射后可以通过独热编码等生产一个向量


![alt text](/assets/2025-02-07-S3.png)


这样我们就成功的将这些字符转换成了一个个向量，一个个segment就是一个个矩阵，我们就可以方便地进行训练了

## 代码
```python
from keras.models import Sequential
from keras.layers import LSTM,Embedding,Dense#由于生产文本是有顺序的，所以是不可以使用双向RNN的
model = Sequential()
vocabular_size = 100
segment = 60
state_dim = 128
model.add(layers.LSTM(state_dim,input_shape=(segment,vocabular_size)))
model.add(layers.Dense(vocabular_size,activation='softmax'))
optimizer = keras.optimizers.RSprop(lr=0.01)
model.compile(loss='categorical_crossentropy',optimizer=optimizer)
model.fit(Segment_X_train,label_y_train,batch_size=64,epochs=10)#训练数据，x是segment，y是下一个字符标签
```
## 预测生成
pred = model.predict(Segment_X_test,verbose=1)
这样可以获得一个概率分布
接下来需要确定预测的策略
第一种是最简单的贪心算法，每次选择概率最大的作为下一个字符
但是贪心有个最大的问题就是输出是固定的，也就是说只要你选择了某个字符，那么之后的输出如果以后遇到一样的，都会续写成一样的内容，缺乏随机性，取决于初始输入
第二种是随机选择，每次选择概率分布中的一个字符作为下一个字符，这样可以增加随机性，但是也会有一定的困难，因为概率分布可能不均匀，导致生成的文本不连贯。
第三种是既有随机性又贪心的结合，他改变了概率的分布，例如把概率做幂变换，然后进行归一化的调整，这样改变了一部分的分布情况。如果幂函数的指数是比较大的情况，会导致接近于贪心算法的一类确定性概率，如果小于1，则会有一定的随机性。

接下来是一个例子：


![alt text](/assets/2025-02-07-S4.png)


类似于上面训练的时候，一步步的步长，通过预测一个个字符然后通过步长来更新，这样就能生产一段文字了。
这类生产需要多个epochs的训练，之后效果可能就会较好，如果想要更加准确可能需要更多的训练数据。
