import GraphView from "@/components/GraphView.tsx";

export const dynamic = "force-dynamic";

export default function GraphPage() {
  return (
    <article>
      <h1>Grafo</h1>
      <p className="infoline">
        <span>arrastra para mover</span><span>rueda para zoom</span>
        <span>clic abre la nota</span><span>⌘clic en pestaña nueva</span>
      </p>
      <GraphView />
    </article>
  );
}
