---
layout: page
title: Knowledge Graph
permalink: /graph/
nav: true
---

<link rel="stylesheet" href="{{ '/assets/css/knowledge-graph.css' | relative_url }}" />

<div id="knowledge-graph-container">
  <div id="graph-controls">
    <button id="graph-reset" class="graph-btn" title="重置视图">
      <i class="fa-solid fa-rotate"></i>
    </button>
    <button id="graph-zoom-in" class="graph-btn" title="放大">
      <i class="fa-solid fa-magnifying-glass-plus"></i>
    </button>
    <button id="graph-zoom-out" class="graph-btn" title="缩小">
      <i class="fa-solid fa-magnifying-glass-minus"></i>
    </button>
  </div>
  <div id="knowledge-graph">
    <div id="graph-loading" class="graph-loading">
      <div class="graph-spinner"></div>
      <span>Loading graph...</span>
    </div>
  </div>
  <div id="graph-legend">
    <span class="legend-item"><span class="legend-dot domain"></span> Domain</span>
    <span class="legend-item"><span class="legend-dot topic"></span> Topic</span>
    <span class="legend-item"><span class="legend-dot post"></span> Post</span>
  </div>
  <div id="graph-stats"></div>
</div>

<script>
window.KNOWLEDGE_GRAPH_DATA = [
  {% for post in site.posts %}
  {% if post.categories.size >= 1 %}
  {
    "title": {{ post.title | jsonify }},
    "url": {{ post.url | relative_url | jsonify }},
    "date": {{ post.date | date: "%Y-%m-%d" | jsonify }},
    "categories": {{ post.categories | jsonify }}
  }{% unless forloop.last %},{% endunless %}
  {% endif %}
  {% endfor %}
];
</script>

<script src="{{ '/assets/js/knowledge-graph.js' | relative_url }}"></script>
