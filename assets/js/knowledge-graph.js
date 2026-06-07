/**
 * Knowledge Graph — Interactive visualization of blog posts relationships
 * Uses ECharts force-directed graph layout
 */

(function () {
  'use strict';

  // --- Build Graph Data ---
  function buildGraphData() {
    var postsData = window.KNOWLEDGE_GRAPH_DATA || [];
    console.log('Building graph with', postsData.length, 'posts');

    var nodes = [];
    var links = [];
    var nodeMap = {};
    var domainColors = {
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
    postsData.forEach(function(post) {
      if (!post.categories || post.categories.length < 2) return;

      var domain = post.categories[0];
      var topic = post.categories[1];

      // Add domain node (level 1)
      if (!nodeMap[domain]) {
        var domainNode = {
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
        };
        nodeMap[domain] = domainNode;
        nodes.push(domainNode);
      }

      // Add topic node (level 2)
      var topicKey = domain + '/' + topic;
      if (!nodeMap[topicKey]) {
        var topicNode = {
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
        };
        nodeMap[topicKey] = topicNode;
        nodes.push(topicNode);
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
      var postKey = post.url;
      if (!nodeMap[postKey]) {
        var postNode = {
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
        };
        nodeMap[postKey] = postNode;
        nodes.push(postNode);
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

    console.log('Graph built:', nodes.length, 'nodes,', links.length, 'links');
    return { nodes: nodes, links: links };
  }

  // --- Chart Initialization ---
  function initChart() {
    var chartDom = document.getElementById('knowledge-graph');
    if (!chartDom) {
      console.error('Chart container not found');
      return;
    }

    if (typeof echarts === 'undefined') {
      console.error('ECharts not loaded');
      return;
    }

    var chart = echarts.init(chartDom, null, { renderer: 'canvas' });
    var graphData = buildGraphData();

    if (graphData.nodes.length === 0) {
      chartDom.innerHTML = '<div style="text-align:center;padding:40px;color:#999;">没有找到文章数据</div>';
      return;
    }

    var option = {
      tooltip: {
        trigger: 'item',
        formatter: (params) => {
          if (params.data.category === 0) {
            return '<div class="graph-tooltip"><strong>' + params.name + '</strong><br/><span style="font-size:12px;color:#999;">一级分类</span></div>';
          } else if (params.data.category === 1) {
            return '<div class="graph-tooltip"><strong>' + params.name + '</strong><br/><span style="font-size:12px;color:#999;">二级分类 · ' + params.data.parentDomain + '</span></div>';
          } else {
            return '<div class="graph-tooltip"><strong>' + params.name + '</strong><br/><span style="font-size:12px;color:#999;">' + params.data.parentDomain + ' / ' + params.data.parentTopic + '</span><br/><span style="font-size:12px;color:#999;">' + params.data.postDate + '</span><br/><span style="font-size:11px;color:#6478e6;">点击查看 →</span></div>';
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
      var isDark = document.documentElement.getAttribute('data-mode') === 'dark';
      var updatedNodes = graphData.nodes.map(function(node) {
        var newNode = Object.assign({}, node);
        if (node.category === 0) {
          newNode.label = Object.assign({}, node.label, {
            color: isDark ? '#e0e0e0' : '#333'
          });
        } else if (node.category === 1) {
          newNode.label = Object.assign({}, node.label, {
            color: isDark ? '#d0d0d0' : '#555'
          });
        }
        return newNode;
      });
      chart.setOption({
        series: [{
          data: updatedNodes
        }]
      });
    }

    // Watch for theme changes
    var observer = new MutationObserver(function (mutations) {
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
    var resetBtn = document.getElementById('graph-reset');
    var zoomInBtn = document.getElementById('graph-zoom-in');
    var zoomOutBtn = document.getElementById('graph-zoom-out');

    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        chart.dispatchAction({ type: 'restore' });
      });
    }

    if (zoomInBtn) {
      zoomInBtn.addEventListener('click', function () {
        chart.dispatchAction({
          type: 'graphRoam',
          zoom: 1.2
        });
      });
    }

    if (zoomOutBtn) {
      zoomOutBtn.addEventListener('click', function () {
        chart.dispatchAction({
          type: 'graphRoam',
          zoom: 0.8
        });
      });
    }

    return chart;
  }

  // --- Load ECharts and Initialize ---
  function loadEChartsAndInit() {
    // First load ECharts
    var script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js';
    script.onload = function () {
      console.log('ECharts loaded');
      initChart();
    };
    script.onerror = function () {
      console.error('Failed to load ECharts');
      var container = document.getElementById('knowledge-graph');
      if (container) {
        container.innerHTML = '<div style="text-align:center;padding:40px;color:#999;">加载图表失败，请刷新页面重试</div>';
      }
    };
    document.head.appendChild(script);
  }

  // --- Initialize when DOM is ready ---
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadEChartsAndInit);
  } else {
    loadEChartsAndInit();
  }
})();
