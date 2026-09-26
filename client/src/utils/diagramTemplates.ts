export const diagramTemplates = {
  mindmap: 'mindmap\n  Root\n    Idea\n',
  flowchart: 'flowchart TD\n  Start --> End\n',
  er: 'erDiagram\n  USER ||--o{ POST : writes\n  USER {\n    int id PK\n  }\n',
  sequence: 'sequenceDiagram\n  Alice->>Bob: Hello\n  Bob-->>Alice: Hi\n',
  class: 'classDiagram\n  Animal <|-- Dog\n  Animal : +eat()\n',
  state: 'stateDiagram-v2\n  [*] --> Ready\n  Ready --> Done\n  Done --> [*]\n',
  gantt: 'gantt\n  title Project plan\n  dateFormat YYYY-MM-DD\n  section Work\n  First task :a1, 2026-01-01, 3d\n',
  pie: 'pie\n  title Work split\n  "Design" : 40\n  "Build" : 60\n',
  timeline: 'timeline\n  title Milestones\n  2025 : Idea\n  2026 : Launch\n',
  gitgraph: 'gitGraph\n  commit\n  branch feature\n  checkout feature\n  commit\n  checkout main\n  merge feature\n',
  journey: 'journey\n  title User journey\n  section Explore\n    Find product: 5: User\n    Try product: 4: User\n',
} as const;

export type DiagramType = keyof typeof diagramTemplates;
export const diagramTypes = Object.keys(diagramTemplates) as DiagramType[];
