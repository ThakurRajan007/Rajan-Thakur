
import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';

// Fixed Node interface to include x and y properties which are required by D3 simulations
interface Node extends d3.SimulationNodeDatum {
  id: string;
  label: string;
  type: string;
  // Explicitly add x and y properties to resolve "Property 'x' does not exist on type Node" errors
  x?: number;
  y?: number;
}

interface Link extends d3.SimulationLinkDatum<Node> {
  source: string | Node;
  target: string | Node;
  relationship: string;
}

interface VisualizerProps {
  data: {
    nodes: Node[];
    links: Link[];
  };
}

const Visualizer: React.FC<VisualizerProps> = ({ data }) => {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || !data.nodes.length) return;

    const width = 800;
    const height = 400;
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const simulation = d3.forceSimulation<Node>(data.nodes)
      .force("link", d3.forceLink<Node, Link>(data.links).id(d => d.id).distance(100))
      .force("charge", d3.forceManyBody().strength(-300))
      .force("center", d3.forceCenter(width / 2, height / 2));

    const link = svg.append("g")
      .attr("stroke", "#475569")
      .attr("stroke-opacity", 0.6)
      .selectAll("line")
      .data(data.links)
      .join("line")
      .attr("stroke-width", 2);

    const node = svg.append("g")
      .selectAll("g")
      .data(data.nodes)
      .join("g")
      .call(d3.drag<any, any>()
        .on("start", (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on("drag", (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on("end", (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        }));

    node.append("circle")
      .attr("r", 15)
      .attr("fill", d => d.type === 'compute' ? '#0ea5e9' : d.type === 'database' ? '#f59e0b' : '#10b981');

    node.append("text")
      .text(d => d.label)
      .attr("x", 20)
      .attr("y", 5)
      .attr("fill", "white")
      .attr("font-size", "12px")
      .attr("font-weight", "500");

    // Handling simulation ticks with updated types
    simulation.on("tick", () => {
      link
        .attr("x1", d => (d.source as Node).x!)
        .attr("y1", d => (d.source as Node).y!)
        .attr("x2", d => (d.target as Node).x!)
        .attr("y2", d => (d.target as Node).y!);

      // Apply transformations using updated Node properties
      node.attr("transform", d => `translate(${d.x},${d.y})`);
    });

  }, [data]);

  return (
    <div className="w-full h-[400px] glass rounded-xl overflow-hidden mt-6">
      <svg ref={svgRef} className="w-full h-full" viewBox="0 0 800 400" preserveAspectRatio="xMidYMid meet" />
    </div>
  );
};

export default Visualizer;
