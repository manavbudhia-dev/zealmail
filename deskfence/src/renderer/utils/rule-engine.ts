import { AutomationRule, RuleCondition, FenceItem } from '../../shared/types';

export class RuleEngine {
  /**
   * Check if a file matches all conditions in a rule
   */
  static matchesRule(
    filePath: string,
    fileName: string,
    fileSize: number,
    rule: AutomationRule,
    fileModified: number = Date.now(),
    isDirectory = false
  ): boolean {
    if (!rule.enabled || !rule.conditions || rule.conditions.length === 0) {
      return false;
    }

    // All conditions must match (AND logic)
    return rule.conditions.every((condition) =>
      this.matchesCondition(filePath, fileName, fileSize, condition, fileModified, isDirectory)
    );
  }

  /** "500", "10KB", "2.5 MB", "1gb" -> bytes. Returns null when it cannot be understood. */
  static parseSize(text: string): number | null {
    const match = text.trim().match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb)?$/i);
    if (!match) return null;
    const units: Record<string, number> = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4 };
    return Math.round(parseFloat(match[1]) * units[(match[2] || 'b').toLowerCase()]);
  }

  /**
   * Check if a file matches a single condition
   */
  private static matchesCondition(
    filePath: string,
    fileName: string,
    fileSize: number,
    condition: RuleCondition,
    fileModified: number,
    isDirectory = false
  ): boolean {
    const value = condition.value;

    switch (condition.type) {
      case 'kind':
        return String(value).trim().toLowerCase() === (isDirectory ? 'folder' : 'file');

      case 'extension': {
        if (isDirectory) return false; // "Projects.v2" is a folder, not a ".v2" file
        // "README" has no extension (it is not "readme"); ".gitignore" neither
        const dot = fileName.lastIndexOf('.');
        const ext = dot > 0 ? fileName.slice(dot + 1).toLowerCase() : '';
        // "jpg, png, gif" = any of these
        const wanted = String(value)
          .split(/[\s,;]+/)
          .map((e) => e.trim().replace(/^\./, '').toLowerCase())
          .filter(Boolean);
        if (wanted.length === 0) return false;

        switch (condition.operator) {
          case 'equals':
            return wanted.includes(ext);
          case 'contains':
            return wanted.some((w) => ext.includes(w));
          default:
            return false;
        }
      }

      case 'name': {
        const lowerName = fileName.toLowerCase();
        const lowerValue = String(value).toLowerCase();

        switch (condition.operator) {
          case 'equals':
            return lowerName === lowerValue;
          case 'contains':
            return lowerName.includes(lowerValue);
          case 'startsWith':
            return lowerName.startsWith(lowerValue);
          case 'endsWith':
            return lowerName.endsWith(lowerValue);
          case 'matches':
            try {
              const regex = new RegExp(String(value), 'i');
              return regex.test(fileName);
            } catch {
              return false;
            }
          default:
            return false;
        }
      }

      case 'size': {
        const targetSize = RuleEngine.parseSize(String(value));
        if (targetSize === null) return false;

        switch (condition.operator) {
          case 'equals':
            return fileSize === targetSize;
          case 'greaterThan':
            return fileSize > targetSize;
          case 'lessThan':
            return fileSize < targetSize;
          default:
            return false;
        }
      }

      case 'path': {
        const lowerPath = filePath.toLowerCase();
        const lowerValue = String(value).toLowerCase();

        switch (condition.operator) {
          case 'equals':
            return lowerPath === lowerValue;
          case 'contains':
            return lowerPath.includes(lowerValue);
          case 'startsWith':
            return lowerPath.startsWith(lowerValue);
          default:
            return false;
        }
      }

      case 'date': {
        // value is a number of days (0.5 = 12 hours). Based on the file's last-modified time:
        //   greaterThan = OLDER than N days   lessThan = NEWER than N days (modified within)
        //   equals = modified on that calendar day, value as YYYY-MM-DD
        if (condition.operator === 'equals') {
          const day = new Date(String(value));
          if (isNaN(day.getTime())) return false;
          return new Date(fileModified).toDateString() === new Date(day.getTime() + day.getTimezoneOffset() * 60000).toDateString();
        }
        const days = Number(value);
        if (isNaN(days) || days < 0) return false;
        const ageDays = (Date.now() - fileModified) / 86400000;
        if (condition.operator === 'greaterThan') return ageDays > days;
        if (condition.operator === 'lessThan') return ageDays < days;
        return false;
      }

      default:
        return false;
    }
  }

  /**
   * Get human-readable description of a rule
   */
  static describeRule(rule: AutomationRule): string {
    const conditions = rule.conditions.map((c) => {
      const type = c.type;
      const op = c.operator.replace(/([A-Z])/g, ' $1').toLowerCase();
      return `${type} ${op} "${c.value}"`;
    }).join(' AND ');

    const action = rule.action === 'move' ? 'Move' :
                   rule.action === 'copy' ? 'Copy' : 'Organize';

    return `${action} files where ${conditions}`;
  }

  /**
   * Create a FenceItem from a file path
   */
  static createFenceItem(filePath: string, fileName: string, fileType: 'file' | 'folder'): FenceItem {
    return {
      id: `item-${Date.now()}-${Math.random()}`,
      name: fileName,
      path: filePath,
      type: fileType,
      position: { x: 0, y: 0 },
    };
  }
}
