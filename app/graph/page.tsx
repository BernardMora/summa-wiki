import GraphView from "@/components/GraphView.tsx";

export const dynamic = "force-dynamic";

export default function GraphPage() {
  return (
    <article>
      <h1>Grafo</h1>
      <p className="infoline">
        <span>arrastra para mover</span><span>rueda para mover</span><span>pellizca para zoom</span>
        <span>clic explora el vecindario</span><span>⌘clic abre la nota</span><span>esc sale</span>
      </p>
      <GraphView />
    </article>
  );
}
