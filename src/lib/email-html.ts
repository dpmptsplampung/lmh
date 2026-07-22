export function escapeHtml(text: string): string {
  return text.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&#39;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

export function bodyToEmailHtml(body: string): string {
  return escapeHtml(body).replace(/\r\n|\r|\n/g, '<br>');
}
