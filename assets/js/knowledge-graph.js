/**
 * Knowledge Graph — Interactive visualization of blog posts relationships
 * Uses ECharts force-directed graph layout
 */

(function () {
  'use strict';

  // --- Data Generation via Liquid ---
  const postsData = [
    {% for post in site.posts %}
    {
      title: {{ post.title | jsonify }},
      url: {{ post.url | relative_url | jsonify }},
      date: {{ post.date | date: "%Y-%m-%d" | jsonify }},
      categories: {{ post.categories | jsonify }}
    }{% unless forloop.last %},{% endunless %}
    {% endfor %}
  ];

  // --- Build Graph Data ---
  function buildGraphData() {
    const nodes = [];
    const links = [];
    const nodeMap = new Map();
    const domainColors = {
      'Study': '#6478e6',
      'Cpp': '#e66478',
      'Python': '#64c8e6',
      'Linux': '#e6a864',
      'Leetcode': '#9c6eff',
      'Office': '#4ecdc4',
      'Blog': '#ff6b9d',
      'Algorithm': '#e66478'
    };

    // Process each post
    postsData.forEach(post => {
      if (!post.categories || post.categories.length < 2) return;

      const domain = post.categories[0];
      const topic = post.categories[1];

      // Add domain node (level 1)
      if (!nodeMap.has(domain)) {
        nodeMap.set(domain, {
          name: domain,
          category: 0,
          symbolSize: 45,
          itemStyle: {
            color: domainColors[domain] || '#6478e6',
            borderColor: '#fff',
            borderWidth: 2
          },
          label: {
            show: true,
            fontSize: 14,
            fontWeight: 'bold'
          }
        });
        nodes.push(nodeMap.get(domain));
      }

      // Add topic node (level 2)
      const topicKey = `${domain}/${topic}`;
      if (!nodeMap.has(topicKey)) {
        nodeMap.set(topicKey, {
          name: topic,
          category: 1,
          symbolSize: 28,
          parentDomain: domain,
          itemStyle: {
            color: '#9c6eff',
            borderColor: '#fff',
            borderWidth: 1
          },
          label: {
            show: true,
            fontSize: 11
          }
        });
        nodes.push(nodeMap.get(topicKey));
        links.push({
          source: domain,
          target: topic,
          lineStyle: {
            color: 'rgba(100, 120, 230, 0.3)',
            width: 2
          }
        });
      }

      // Add post node (level 3)
      const postKey = post.url;
      if (!nodeMap.has(postKey)) {
        nodeMap.set(postKey, {
          name: post.title,
          category: 2,
          symbolSize: 12,
          postUrl: post.url,
          postDate: post.date,
          parentTopic: topic,
          parentDomain: domain,
          itemStyle: {
            color: '#4ecdc4',
            borderColor: '#fff',
            borderWidth: 0
          },
          label: {
            show: false
          }
        });
        nodes.push(nodeMap.get(postKey));
        links.push({
          source: topic,
          target: post.title,
          lineStyle: {
            color: 'rgba(78, 205, 196, 0.2)',
            width: 1
          }
        });
      }
    });

    return { nodes, links };
  }

  // --- Chart Initialization ---
  function initChart() {
    const chartDom = document.getElementById('knowledge-graph');
    if (!chartDom) return;

    const chart = echarts.init(chartDom, null, { renderer: 'canvas' });
    const graphData = buildGraphData();

    const option = {
      tooltip: {
        trigger: 'item',
        formatter: function (params) {
          if (params.data.category === 0) {
            return `<div class="graph-tooltip">
              <strong>${params.name}</strong><br/>
              <span style="font-size:12px;color:#999;">一级分类</span>
            </div>`;
          } else if (params.data.category === 1) {
            return `<div class="graph-tooltip">
              <strong>${params.name}</strong><br/>
              <span style="font-size:12px;color:#999;">二级分类 · ${params.data.parentDomain}</span>
            </div>`;
          } else {
            return `<div class="graph-tooltip">
              <strong>${params.name}</strong><br/>
              <span style="font-size:12px;color:#999;">${params.data.parentDomain} / ${params.data.parentTopic}</span><br/>
              <span style="font-size:12px;color:#999;">${params.data.postDate}</span><br/>
              <span style="font-size:11px;color:#6478e6;">点击查看 →</span>
            </div>`;
          }
        },
        backgroundColor: 'transparent',
        borderColor: 'transparent',
        extraCssText: 'box-shadow: none;'
      },
      animationDuration: 1500,
      animationEasingUpdate: 'quinticInOut',
      series: [{
        type: 'graph',
        layout: 'force',
        data: graphData.nodes,
        links: graphData.links,
        categories: [
          { name: '一级分类' },
          { name: '二级分类' },
          { name: '文章' }
        ],
        roam: true,
        draggable: true,
        force: {
          repulsion: 300,
          gravity: 0.1,
          edgeLength: [80, 200],
          layoutAnimation: true
        },
        emphasis: {
          focus: 'adjacency',
          blurScope: 'coordinateSystem',
          lineStyle: {
            width: 3
          }
        },
        blur: {
          itemStyle: {
            opacity: 0.15
          },
          lineStyle: {
            opacity: 0.05
          }
        },
        label: {
          position: 'right',
          distance: 8
        },
        lineStyle: {
          curveness: 0.2
        }
      }]
    };

    chart.setOption(option);

    // Click handler for post nodes
    chart.on('click', function (params) {
      if (params.data.category === 2 && params.data.postUrl) {
        window.location.href = params.data.postUrl;
      }
    });

    // Theme update function
    function updateTheme() {
      const isDark = document.documentElement.getAttribute('data-mode') === 'dark';
      chart.setOption({
        series: [{
          data: graphData.nodes.map(node => {
            if (node.category === 0) {
              return {
                ...node,
                label: {
                  ...node.label,
                  color: isDark ? '#e0e0e0' : '#333'
                }
              };
            } else if (node.category === 1) {
              return {
                ...node,
                label: {
                  ...node.label,
                  color: isDark ? '#d0d0d0' : '#555'
                }
              };
            }
            return node;
          })
        }]
      });
    }

    // Watch for theme changes
    const observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        if (mutation.attributeName === 'data-mode') {
          updateTheme();
        }
      });
    });
    observer.observe(document.documentElement, { attributes: true });

    // Resize handler
    window.addEventListener('resize', function () {
      chart.resize();
    });

    // Control buttons
    document.getElementById('graph-reset')?.addEventListener('click', function () {
      chart.dispatchAction({ type: 'restore' });
    });

    document.getElementById('graph-zoom-in')?.addEventListener('click', function () {
      chart.dispatchAction({
        type: 'graphRoam',
        zoom: 1.2
      });
    });

    document.getElementById('graph-zoom-out')?.addEventListener('click', function () {
      chart.dispatchAction({
        type: 'graphRoam',
        zoom: 0.8
      });
    });

    return chart;
  }

  // --- Load ECharts and Initialize ---
  function loadECharts() {
    if (typeof echarts !== 'undefined') {
      initChart();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js';
    script.onload = function () {
      initChart();
    };
    script.onerror = function () {
      console.error('Failed to load ECharts');
      const container = document.getElementById('knowledge-graph');
      if (container) {
        container.innerHTML = '<div style="text-align:center;padding:40px;color:#999;">加载图表失败，请刷新页面重试</div>';
      }
    };
    document.head.appendChild(script);
  }

  // --- Initialize when DOM is ready ---
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadECharts);
  } else {
    loadECharts();
  }
})();
