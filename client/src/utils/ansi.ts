interface AnsiState {
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  blink: boolean;
  inverse: boolean;
  strikethrough: boolean;
  fgColor: string | null;
  bgColor: string | null;
}

const ANSI_COLORS: Record<number, string> = {
  0: '#000000',   // Black
  1: '#e74856',   // Red
  2: '#16c60c',   // Green
  3: '#f9f1a5',   // Yellow
  4: '#3b78ff',   // Blue
  5: '#b4009e',   // Magenta
  6: '#61d6d6',   // Cyan
  7: '#cccccc',   // White
  8: '#767676',   // Bright Black (Gray)
  9: '#ff6b6b',   // Bright Red
  10: '#5af78e',  // Bright Green
  11: '#f4f99d',  // Bright Yellow
  12: '#92a8ff',  // Bright Blue
  13: '#ff92d0',  // Bright Magenta
  14: '#9aedfe',  // Bright Cyan
  15: '#e6e6e6',  // Bright White
};

function createAnsiState(): AnsiState {
  return {
    bold: false,
    dim: false,
    italic: false,
    underline: false,
    blink: false,
    inverse: false,
    strikethrough: false,
    fgColor: null,
    bgColor: null,
  };
}

function parseAnsiCode(code: number, state: AnsiState): AnsiState {
  const nextState = { ...state };

  switch (code) {
    case 0:
      return createAnsiState();
    case 1:
      nextState.bold = true;
      break;
    case 2:
      nextState.dim = true;
      break;
    case 3:
      nextState.italic = true;
      break;
    case 4:
      nextState.underline = true;
      break;
    case 5:
    case 6:
      nextState.blink = true;
      break;
    case 7:
      nextState.inverse = true;
      break;
    case 9:
      nextState.strikethrough = true;
      break;
    case 22:
      nextState.bold = false;
      nextState.dim = false;
      break;
    case 23:
      nextState.italic = false;
      break;
    case 24:
      nextState.underline = false;
      break;
    case 25:
      nextState.blink = false;
      break;
    case 27:
      nextState.inverse = false;
      break;
    case 29:
      nextState.strikethrough = false;
      break;
    case 39:
      nextState.fgColor = null;
      break;
    case 49:
      nextState.bgColor = null;
      break;
    default:
      if (code >= 30 && code <= 37) {
        nextState.fgColor = ANSI_COLORS[code - 30];
      } else if (code >= 40 && code <= 47) {
        nextState.bgColor = ANSI_COLORS[code - 40];
      } else if (code >= 90 && code <= 97) {
        nextState.fgColor = ANSI_COLORS[code - 90 + 8];
      } else if (code >= 100 && code <= 107) {
        nextState.bgColor = ANSI_COLORS[code - 100 + 8];
      }
  }

  return nextState;
}

function stateToStyle(state: AnsiState): string {
  const styles: string[] = [];
  
  if (state.bold) {
    styles.push('font-weight: bold');
  }
  if (state.dim) {
    styles.push('opacity: 0.7');
  }
  if (state.italic) {
    styles.push('font-style: italic');
  }
  if (state.underline) {
    styles.push('text-decoration: underline');
  }
  if (state.strikethrough) {
    styles.push('text-decoration: line-through');
  }
  if (state.fgColor) {
    styles.push(`color: ${state.fgColor}`);
  }
  if (state.bgColor) {
    styles.push(`background-color: ${state.bgColor}`);
  }
  
  return styles.join('; ');
}

export function ansiToHtml(text: string): string {
  // Keep HTML escaping with the markdown renderer so code blocks preserve literal < and > characters.
  const result = text;
  const ansiRegex = /(?:\x1b|\u001b)?\[([0-9;]*)m/g;

  let state = createAnsiState();
  let lastIndex = 0;
  let output = '';
  let hasOpenSpan = false;
  
  let match: RegExpExecArray | null;
  while ((match = ansiRegex.exec(result)) !== null) {
    if (match.index > lastIndex) {
      output += result.slice(lastIndex, match.index);
    }

    if (hasOpenSpan) {
      output += '</span>';
      hasOpenSpan = false;
    }
    
    const codes = match[1] ? match[1].split(';').map(Number) : [0];

    for (const code of codes) {
      state = parseAnsiCode(code || 0, state);
    }
    
    const style = stateToStyle(state);
    if (style) {
      output += `<span style="${style}">`;
      hasOpenSpan = true;
    }
    
    lastIndex = match.index + match[0].length;
  }
  
  if (lastIndex < result.length) {
    output += result.slice(lastIndex);
  }

  if (hasOpenSpan) {
    output += '</span>';
  }
  
  return output;
}
