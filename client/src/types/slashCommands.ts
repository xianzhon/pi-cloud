export type SlashCommandCategory = 'skill' | 'extension' | 'built-in';

export interface SlashCommandItem {
  id: string;
  label: string;
  insertText: string;
  description: string;
  category: SlashCommandCategory;
  aliases?: string[];
}

export interface SlashToken {
  start: number;
  end: number;
  query: string;
}
