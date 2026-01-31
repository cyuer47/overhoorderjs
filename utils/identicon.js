// Simple Identicon Generator
class Identicon {
  constructor(size = 64, hash = null) {
    this.size = size;
    this.hash = hash || this.generateHash();
  }

  generateHash() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }

  hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash;
  }

  getColor(index) {
    const hue = (this.hashCode(index.toString()) * 137.5) % 360;
    return `hsl(${hue}, 70%, 60%)`;
  }

  generateSVG(seed) {
    const hash = this.hashCode(seed);
    const colors = [
      this.getColor(hash),
      this.getColor(hash + 1),
      this.getColor(hash + 2)
    ];
    
    const blocks = [];
    for (let i = 0; i < 25; i++) {
      const bit = (hash >> i) & 1;
      const mirrored = i % 5 < 2 ? i + 4 - (i % 5) * 2 : i;
      blocks[mirrored] = bit;
    }
    
    let svg = `<svg width="${this.size}" height="${this.size}" viewBox="0 0 5 5" xmlns="http://www.w3.org/2000/svg">`;
    
    // Background
    svg += `<rect width="5" height="5" fill="#f0f0f0"/>`;
    
    // Blocks
    blocks.forEach((bit, index) => {
      if (bit) {
        const x = index % 5;
        const y = Math.floor(index / 5);
        const color = colors[Math.floor(index / 9) % colors.length];
        svg += `<rect x="${x}" y="${y}" width="1" height="1" fill="${color}"/>`;
      }
    });
    
    svg += '</svg>';
    return svg;
  }

  getDataURL(seed) {
    const svg = this.generateSVG(seed);
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    return URL.createObjectURL(blob);
  }
}

// Global function for generating identicons
function generateIdenticon(seed, size = 64) {
  const identicon = new Identicon(size);
  return identicon.getDataURL(seed);
}
