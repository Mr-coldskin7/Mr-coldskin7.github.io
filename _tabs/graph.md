---
title: 知识图谱
icon: fas fa-project-diagram
order: 5
---

<div id="knowledge-graph-container">
  <div id="graph-controls">
    <button id="graph-reset" class="graph-btn" title="重置视图">
      <i class="fas fa-sync-alt"></i>
    </button>
    <button id="graph-zoom-in" class="graph-btn" title="放大">
      <i class="fas fa-search-plus"></i>
    </button>
    <button id="graph-zoom-out" class="graph-btn" title="缩小">
      <i class="fas fa-search-minus"></i>
    </button>
  </div>
  <div id="knowledge-graph"></div>
  <div id="graph-legend">
    <span class="legend-item"><span class="legend-dot domain"></span> 一级分类</span>
    <span class="legend-item"><span class="legend-dot topic"></span> 二级分类</span>
    <span class="legend-item"><span class="legend-dot post"></span> 文章</span>
  </div>
</div>
