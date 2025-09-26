---
title: 旋转矩阵的理解
date: 2025-09-25 17:21:00 +0800
categories: [Study, CS231A]
tags: [study]
---
## active transformation
由于运动是相对的，所以分为主动和被动的变换，就例如我主动平移点是一种平移，我变换坐标轴也是一种平移
## passive transformation

如果一般的三维重构的话，应该考虑都是被动的变换，因为点是不变的变得是自己的视角
\[
\tilde{X}_c = \begin{pmatrix} I & t_{cw} \\ 0 & 1 \end{pmatrix} \tilde{X}_w
\]

$$
X_c = X_w + t_{cw}
$$
在三维重构的场景中，应该把X_w看作是不变的，变得是t

**Active or Passive?**

> **Passive!**  
> 相机动了，但是 3D 点没动，所以应该按 **Passive** 理解。

那么：

$$
X_c = X_w - (- t_{cw}) = X_{w}-t_{wc}
$$

- $t_wc$ 也是相机光心在世界坐标系中的坐标，也是实实在在的向量，可被直观、可视化、几何图形化地理解。
- $t_cw$ 也是相机光心指向世界坐标系，摄像头看世界

那么旋转矩阵 $R$ 呢？ 

$$
X_c = R_{cw} X_w
$$

向量和坐标？
坐标是系数，只是几个数，向量是有方向的（从原点开始的）
有了基向量才能明确坐标

坐标是用来线性组合基的

矩阵可以理解为对基向量用坐标的加权求和，矩阵乘法本质上是一种线性变换，它可以通过基向量的线性组合来表示向量在不同坐标系中的变化
这是按照列空间来理解的
![alt text](/assets/image-12.png)

![alt text](/assets/image-13.png)

## Vector Rotation

它是一个动作，一个函数，一个过程，只不过是用rotation matrix来表达这个函数

> From Wikipedia, the free encyclopedia

In linear algebra, a **rotation matrix** is a transformation matrix that

\[
R = \begin{bmatrix} \cos \theta & -\sin \theta \\ \sin \theta & \cos \theta \end{bmatrix}
\]

rotates points in the xy plane counterclockwise through an angle \(\theta\) perform the rotation on a plane point with standard coordinates \(\mathbf{v}\)

\[
R\mathbf{v} = \begin{bmatrix} \cos \theta & -\sin \theta \\ \sin \theta & \cos \theta \end{bmatrix} \begin{bmatrix} x \\ y \end{bmatrix} = \begin{bmatrix} x \cos \theta - y \sin \theta \\ x \sin \theta + y \cos \theta \end{bmatrix}.
\]

矩阵乘法看作是变基，就像是把原本的点映射到了一个新的坐标系一样
所以$$R_{cw}的行$$或者是
$$R_{wc}的列$$
可以看作是摄像机坐标系下的三个基向量在世界坐标系下的表示
由于 R wc 是 R cw的逆，它们在几何上描述了相反的变换，因此它们的行和列向量分别表示相反的基向量关系

\[
\tilde{X}_c = M_{cw} \tilde{X}_w = \begin{pmatrix} R & t \\ 0 & 1 \end{pmatrix} \tilde{X}_w = \begin{pmatrix} R_{cw} & t_{cw} \\ 0 & 1 \end{pmatrix} \tilde{X}_w
\]

\[
\tilde{X}_w = M_{wc} \tilde{X}_c = \begin{pmatrix} R^T & -R^T t \\ 0 & 1 \end{pmatrix} \tilde{X}_c = \begin{pmatrix} R_{wc} & t_{wc} \\ 0 & 1 \end{pmatrix} \tilde{X}_c
\]