/**
 * Knowledge Graph — Interactive visualization of blog posts relationships
 * Uses ECharts force-directed graph layout
 */

(function () {
  "use strict";

  // --- Color helpers ---
  var domainColors = {
    study: "#6366f1",
    cpp: "#f43f5e",
    python: "#3b82f6",
    linux: "#f59e0b",
    leetcode: "#8b5cf6",
    office: "#10b981",
    blog: "#ec4899",
    algorithm: "#f97316",
    rag: "#8b5cf6",
    agent: "#14b8a6",
  };

  function hexToRgb(hex) {
    var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? {
          r: parseInt(result[1], 16),
          g: parseInt(result[2], 16),
          b: parseInt(result[3], 16),
        }
      : { r: 99, g: 102, b: 241 };
  }

  function rgba(hex, alpha) {
    var rgb = hexToRgb(hex);
    return "rgba(" + rgb.r + ", " + rgb.g + ", " + rgb.b + ", " + alpha + ")";
  }

  // --- Build Graph Data ---
  function buildGraphData() {
    var postsData = window.KNOWLEDGE_GRAPH_DATA || [];
    console.log("Building graph with", postsData.length, "posts");

    var nodes = [];
    var links = [];
    var nodeMap = {};

    // Process each post
    postsData.forEach(function (post) {
      if (!post.categories || post.categories.length < 1) return;

      var domain = post.categories[0];
      var topic = post.categories[1] || "General";

      // Use globally unique names for link resolution (ECharts graph matches
      // links to nodes by name). A domain and a topic can share the same
      // display string (e.g. "Cpp" is both a domain and a topic under
      // "Algorithm"), so bare names collide and merge into one node. Prefix
      // each id and render the pretty label via label.formatter instead.
      var domainKey = "d:" + domain;
      var topicKey = "t:" + domain + "/" + topic;
      var postKey = "p:" + post.url;

      var baseColor = domainColors[(domain || "").toLowerCase()] || "#6366f1";

      // Add domain node (level 1)
      if (!nodeMap[domainKey]) {
        var domainNode = {
          name: domainKey,
          displayName: domain,
          category: 0,
          symbolSize: 48,
          itemStyle: {
            color: baseColor,
            borderColor: "#fff",
            borderWidth: 2,
            shadowBlur: 12,
            shadowColor: rgba(baseColor, 0.4),
          },
          label: {
            show: true,
            fontSize: 15,
            fontWeight: "bold",
            formatter: function () {
              return domain;
            },
          },
        };
        nodeMap[domainKey] = domainNode;
        nodes.push(domainNode);
      }

      // Add topic node (level 2)
      if (!nodeMap[topicKey]) {
        var topicNode = {
          name: topicKey,
          displayName: topic,
          category: 1,
          symbolSize: 30,
          parentDomain: domain,
          itemStyle: {
            color: rgba(baseColor, 0.75),
            borderColor: "#fff",
            borderWidth: 1,
          },
          label: {
            show: true,
            fontSize: 12,
            formatter: function () {
              return topic;
            },
          },
        };
        nodeMap[topicKey] = topicNode;
        nodes.push(topicNode);
        links.push({
          source: domainKey,
          target: topicKey,
          lineStyle: {
            color: rgba(baseColor, 0.35),
            width: 2,
          },
        });
      }

      // Add post node (level 3)
      if (!nodeMap[postKey]) {
        var postNode = {
          name: postKey,
          displayName: post.title,
          category: 2,
          symbolSize: 10,
          postUrl: post.url,
          postDate: post.date,
          parentTopic: topic,
          parentDomain: domain,
          itemStyle: {
            color: rgba(baseColor, 0.9),
            borderColor: "#fff",
            borderWidth: 0,
          },
          label: {
            show: false,
            fontSize: 11,
            formatter: function () {
              return post.title;
            },
          },
          emphasis: {
            label: {
              show: true,
            },
            itemStyle: {
              shadowBlur: 10,
              shadowColor: rgba(baseColor, 0.6),
            },
          },
        };
        nodeMap[postKey] = postNode;
        nodes.push(postNode);
        links.push({
          source: topicKey,
          target: postKey,
          lineStyle: {
            color: rgba(baseColor, 0.25),
            width: 1,
          },
        });
      }
    });

    console.log("Graph built:", nodes.length, "nodes,", links.length, "links");
    return { nodes: nodes, links: links };
  }

  // --- Chart Initialization ---
  function initChart() {
    var chartDom = document.getElementById("knowledge-graph");
    if (!chartDom) {
      console.error("Chart container not found");
      return;
    }

    if (typeof echarts === "undefined") {
      console.error("ECharts not loaded");
      return;
    }

    var chart = echarts.init(chartDom, null, { renderer: "canvas" });
    var graphData = buildGraphData();
    var loadingEl = document.getElementById("graph-loading");
    var statsEl = document.getElementById("graph-stats");

    if (loadingEl) {
      loadingEl.classList.add("hidden");
    }

    if (graphData.nodes.length === 0) {
      chartDom.innerHTML = '<div style="text-align:center;padding:40px;color:#999;">No posts found</div>';
      if (statsEl) statsEl.textContent = "";
      return;
    }

    var postCount = graphData.nodes.filter(function (n) {
      return n.category === 2;
    }).length;
    var topicCount = graphData.nodes.filter(function (n) {
      return n.category === 1;
    }).length;
    var domainCount = graphData.nodes.filter(function (n) {
      return n.category === 0;
    }).length;
    if (statsEl) {
      statsEl.textContent = domainCount + " domains · " + topicCount + " topics · " + postCount + " posts";
    }

    var option = {
      tooltip: {
        trigger: "item",
        formatter: (params) => {
          var name = params.data.displayName || params.name;
          if (params.data.category === 0) {
            return '<div class="graph-tooltip"><strong>' + name + '</strong><br/><span style="font-size:12px;color:#999;">Domain</span></div>';
          } else if (params.data.category === 1) {
            return (
              '<div class="graph-tooltip"><strong>' +
              name +
              '</strong><br/><span style="font-size:12px;color:#999;">Topic · ' +
              params.data.parentDomain +
              "</span></div>"
            );
          } else {
            return (
              '<div class="graph-tooltip"><strong>' +
              name +
              '</strong><br/><span style="font-size:12px;color:#999;">' +
              params.data.parentDomain +
              " / " +
              params.data.parentTopic +
              '</span><br/><span style="font-size:12px;color:#999;">' +
              params.data.postDate +
              '</span><br/><span style="font-size:11px;color:#6478e6;">Click to read →</span></div>'
            );
          }
        },
        backgroundColor: "transparent",
        borderColor: "transparent",
        extraCssText: "box-shadow: none;",
      },
      animationDuration: 1500,
      animationEasingUpdate: "quinticInOut",
      series: [
        {
          type: "graph",
          layout: "force",
          data: graphData.nodes,
          links: graphData.links,
          categories: [{ name: "Domain" }, { name: "Topic" }, { name: "Post" }],
          roam: true,
          draggable: true,
          force: {
            repulsion: 450,
            gravity: 0.08,
            edgeLength: [60, 180],
            layoutAnimation: true,
          },
          emphasis: {
            focus: "adjacency",
            blurScope: "coordinateSystem",
            lineStyle: {
              width: 3,
            },
          },
          blur: {
            itemStyle: {
              opacity: 0.12,
            },
            lineStyle: {
              opacity: 0.04,
            },
          },
          label: {
            position: "right",
            distance: 8,
          },
          lineStyle: {
            curveness: 0.2,
          },
        },
      ],
    };

    chart.setOption(option);

    // Click handler for post nodes
    chart.on("click", function (params) {
      if (params.data.category === 2 && params.data.postUrl) {
        window.location.href = params.data.postUrl;
      }
    });

    // Theme update function
    function updateTheme() {
      var isDark = document.documentElement.getAttribute("data-mode") === "dark";
      var updatedNodes = graphData.nodes.map(function (node) {
        var newNode = Object.assign({}, node);
        if (node.category === 0) {
          newNode.label = Object.assign({}, node.label, {
            color: isDark ? "#e0e0e0" : "#333",
          });
        } else if (node.category === 1) {
          newNode.label = Object.assign({}, node.label, {
            color: isDark ? "#d0d0d0" : "#555",
          });
        }
        return newNode;
      });
      chart.setOption({
        series: [
          {
            data: updatedNodes,
          },
        ],
      });
    }

    // Watch for theme changes
    var observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        if (mutation.attributeName === "data-mode") {
          updateTheme();
        }
      });
    });
    observer.observe(document.documentElement, { attributes: true });

    // Resize handler
    window.addEventListener("resize", function () {
      chart.resize();
    });

    // Control buttons
    var resetBtn = document.getElementById("graph-reset");
    var zoomInBtn = document.getElementById("graph-zoom-in");
    var zoomOutBtn = document.getElementById("graph-zoom-out");

    if (resetBtn) {
      resetBtn.addEventListener("click", function () {
        chart.dispatchAction({ type: "restore" });
      });
    }

    if (zoomInBtn) {
      zoomInBtn.addEventListener("click", function () {
        chart.dispatchAction({
          type: "graphRoam",
          zoom: 1.2,
        });
      });
    }

    if (zoomOutBtn) {
      zoomOutBtn.addEventListener("click", function () {
        chart.dispatchAction({
          type: "graphRoam",
          zoom: 0.8,
        });
      });
    }

    return chart;
  }

  // --- Load ECharts and Initialize ---
  function loadEChartsAndInit() {
    var script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js";
    script.onload = function () {
      console.log("ECharts loaded");
      initChart();
    };
    script.onerror = function () {
      console.error("Failed to load ECharts");
      var loadingEl = document.getElementById("graph-loading");
      var container = document.getElementById("knowledge-graph");
      if (loadingEl) loadingEl.classList.add("hidden");
      if (container) {
        container.innerHTML = '<div style="text-align:center;padding:40px;color:#999;">Failed to load chart. Please refresh.</div>';
      }
    };
    document.head.appendChild(script);
  }

  // --- Initialize when DOM is ready ---
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadEChartsAndInit);
  } else {
    loadEChartsAndInit();
  }
})();
