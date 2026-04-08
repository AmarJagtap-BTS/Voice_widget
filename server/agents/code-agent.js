/**
 * CODE AGENT
 * Clones and analyzes Git repositories, indexes code files, and answers questions about codebases.
 * 
 * Tools:
 * - clone_repo: Clone a Git repository
 * - list_repo_files: List all files in a cloned repo with optional filtering
 * - read_code_file: Read contents of a specific file
 * - search_code: Search for patterns across all files
 * - analyze_structure: Analyze project structure (languages, frameworks, dependencies)
 * - explain_function: Find and explain a specific function/class
 * - list_dependencies: List all dependencies from package.json, requirements.txt, etc.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class CodeAgent {
  constructor(reposBaseDir = path.join(__dirname, '../repos')) {
    this.reposBaseDir = reposBaseDir;
    this.ensureReposDir();
    
    // Cache of cloned repos: { repoKey: { path, url, clonedAt } }
    this.repos = {};
    this.loadExistingRepos();
  }

  ensureReposDir() {
    if (!fs.existsSync(this.reposBaseDir)) {
      fs.mkdirSync(this.reposBaseDir, { recursive: true });
    }
  }

  loadExistingRepos() {
    // Load previously cloned repos
    try {
      const items = fs.readdirSync(this.reposBaseDir, { withFileTypes: true });
      for (const item of items) {
        if (item.isDirectory()) {
          const repoPath = path.join(this.reposBaseDir, item.name);
          this.repos[item.name] = {
            path: repoPath,
            url: null, // Unknown from cache
            clonedAt: fs.statSync(repoPath).birthtimeMs
          };
        }
      }
    } catch (err) {
      console.warn('[CodeAgent] Failed to load existing repos:', err.message);
    }
  }

  /**
   * Get a summary of all loaded/cloned repos for system prompt injection.
   * Returns an array of { repoKey, path, fileCount }
   */
  getLoadedReposSummary() {
    const summary = [];
    for (const [key, info] of Object.entries(this.repos)) {
      summary.push({
        repoKey: key,
        path: info.path,
        fileCount: this.countFiles(info.path)
      });
    }
    return summary;
  }

  /**
   * Generate a safe directory name from a Git URL
   */
  getRepoKey(gitUrl) {
    // Extract repo name from URL: https://github.com/user/repo.git -> user-repo
    const match = gitUrl.match(/github\.com[\/:]([^\/]+)\/([^\.]+)/i);
    if (match) return `${match[1]}-${match[2]}`.toLowerCase();
    
    // Fallback: hash the URL
    return Buffer.from(gitUrl).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 20);
  }

  /**
   * Clone a Git repository
   */
  cloneRepo(gitUrl, branch = 'main') {
    const repoKey = this.getRepoKey(gitUrl);
    const repoPath = path.join(this.reposBaseDir, repoKey);

    // Check if already cloned
    if (this.repos[repoKey]) {
      return {
        success: true,
        repoKey,
        path: repoPath,
        message: 'Repository already cloned',
        alreadyExists: true
      };
    }

    try {
      // Clone with depth=1 for faster cloning
      const cmd = `git clone --depth 1 --branch ${branch} "${gitUrl}" "${repoPath}"`;
      execSync(cmd, { stdio: 'pipe' });

      this.repos[repoKey] = {
        path: repoPath,
        url: gitUrl,
        clonedAt: Date.now()
      };

      const fileCount = this.countFiles(repoPath);
      return {
        success: true,
        repoKey,
        path: repoPath,
        fileCount,
        message: `Successfully cloned repository (${fileCount} files)`
      };
    } catch (err) {
      return {
        success: false,
        error: err.message,
        message: `Failed to clone repository: ${err.message}`
      };
    }
  }

  /**
   * Count files in a directory (excluding .git)
   */
  countFiles(dir, count = 0) {
    try {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        if (item.name === '.git' || item.name === 'node_modules') continue;
        const fullPath = path.join(dir, item.name);
        if (item.isDirectory()) {
          count = this.countFiles(fullPath, count);
        } else {
          count++;
        }
      }
    } catch (err) {
      // Ignore permission errors
    }
    return count;
  }

  /**
   * List all files in a repository with optional filtering
   */
  listRepoFiles(repoKey, extensions = [], maxDepth = 5) {
    if (!this.repos[repoKey]) {
      return { success: false, error: 'Repository not found. Clone it first.' };
    }

    const repoPath = this.repos[repoKey].path;
    const files = [];
    const exts = extensions.length > 0 ? extensions.map(e => e.startsWith('.') ? e : `.${e}`) : null;

    const walk = (dir, depth = 0) => {
      if (depth > maxDepth) return;
      try {
        const items = fs.readdirSync(dir, { withFileTypes: true });
        for (const item of items) {
          if (item.name === '.git' || item.name === 'node_modules' || item.name === '.vscode') continue;
          const fullPath = path.join(dir, item.name);
          const relativePath = path.relative(repoPath, fullPath);
          
          if (item.isDirectory()) {
            walk(fullPath, depth + 1);
          } else {
            // Filter by extension if specified
            if (!exts || exts.some(e => item.name.endsWith(e))) {
              files.push({
                path: relativePath,
                name: item.name,
                size: fs.statSync(fullPath).size
              });
            }
          }
        }
      } catch (err) {
        // Ignore permission errors
      }
    };

    walk(repoPath);
    return {
      success: true,
      repoKey,
      files,
      count: files.length
    };
  }

  /**
   * Read contents of a specific file
   */
  readCodeFile(repoKey, filePath) {
    if (!this.repos[repoKey]) {
      return { success: false, error: 'Repository not found. Clone it first.' };
    }

    const fullPath = path.join(this.repos[repoKey].path, filePath);
    
    // Security: ensure path is within repo
    if (!fullPath.startsWith(this.repos[repoKey].path)) {
      return { success: false, error: 'Invalid file path' };
    }

    try {
      const content = fs.readFileSync(fullPath, 'utf8');
      const lines = content.split('\n').length;
      return {
        success: true,
        filePath,
        content,
        lines,
        size: Buffer.byteLength(content, 'utf8')
      };
    } catch (err) {
      return { success: false, error: `Failed to read file: ${err.message}` };
    }
  }

  /**
   * Search for a pattern across all code files
   */
  searchCode(repoKey, searchTerm, extensions = [], caseSensitive = false, maxResults = 50) {
    if (!this.repos[repoKey]) {
      return { success: false, error: 'Repository not found. Clone it first.' };
    }

    const repoPath = this.repos[repoKey].path;
    const results = [];
    const exts = extensions.length > 0 ? extensions.map(e => e.startsWith('.') ? e : `.${e}`) : null;
    const pattern = caseSensitive ? searchTerm : searchTerm.toLowerCase();

    const search = (dir) => {
      if (results.length >= maxResults) return;
      try {
        const items = fs.readdirSync(dir, { withFileTypes: true });
        for (const item of items) {
          if (results.length >= maxResults) break;
          if (item.name === '.git' || item.name === 'node_modules') continue;
          
          const fullPath = path.join(dir, item.name);
          
          if (item.isDirectory()) {
            search(fullPath);
          } else {
            // Filter by extension
            if (exts && !exts.some(e => item.name.endsWith(e))) continue;
            
            try {
              const content = fs.readFileSync(fullPath, 'utf8');
              const lines = content.split('\n');
              const searchContent = caseSensitive ? content : content.toLowerCase();
              
              if (searchContent.includes(pattern)) {
                const relativePath = path.relative(repoPath, fullPath);
                const matches = [];
                
                lines.forEach((line, idx) => {
                  const searchLine = caseSensitive ? line : line.toLowerCase();
                  if (searchLine.includes(pattern)) {
                    matches.push({
                      line: idx + 1,
                      content: line.trim(),
                      context: lines.slice(Math.max(0, idx - 1), Math.min(lines.length, idx + 2))
                    });
                  }
                });
                
                results.push({
                  file: relativePath,
                  matches: matches.slice(0, 5) // Max 5 matches per file
                });
              }
            } catch (err) {
              // Ignore binary files or permission errors
            }
          }
        }
      } catch (err) {
        // Ignore permission errors
      }
    };

    search(repoPath);
    return {
      success: true,
      repoKey,
      searchTerm,
      results,
      totalFiles: results.length
    };
  }

  /**
   * Analyze project structure (languages, frameworks, dependencies)
   */
  analyzeStructure(repoKey) {
    if (!this.repos[repoKey]) {
      return { success: false, error: 'Repository not found. Clone it first.' };
    }

    const repoPath = this.repos[repoKey].path;
    const analysis = {
      languages: {},
      frameworks: [],
      dependencies: {},
      configFiles: []
    };

    // Detect language by file extensions
    const langExtensions = {
      JavaScript: ['.js', '.jsx', '.mjs'],
      TypeScript: ['.ts', '.tsx'],
      Python: ['.py'],
      Java: ['.java'],
      'C#': ['.cs'],
      Go: ['.go'],
      Rust: ['.rs'],
      Ruby: ['.rb'],
      PHP: ['.php'],
      Swift: ['.swift'],
      Kotlin: ['.kt']
    };

    const walk = (dir) => {
      try {
        const items = fs.readdirSync(dir, { withFileTypes: true });
        for (const item of items) {
          if (item.name === '.git' || item.name === 'node_modules') continue;
          const fullPath = path.join(dir, item.name);
          
          if (item.isDirectory()) {
            walk(fullPath);
          } else {
            // Count by language
            for (const [lang, exts] of Object.entries(langExtensions)) {
              if (exts.some(e => item.name.endsWith(e))) {
                analysis.languages[lang] = (analysis.languages[lang] || 0) + 1;
              }
            }

            // Detect config files
            if (['package.json', 'requirements.txt', 'Gemfile', 'go.mod', 'pom.xml', 'build.gradle', 'Cargo.toml'].includes(item.name)) {
              analysis.configFiles.push(path.relative(repoPath, fullPath));
            }
          }
        }
      } catch (err) {
        // Ignore
      }
    };

    walk(repoPath);

    // Detect frameworks from package.json
    const packageJsonPath = path.join(repoPath, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
        analysis.dependencies = allDeps;

        // Detect frameworks
        if (allDeps.react) analysis.frameworks.push('React');
        if (allDeps.vue) analysis.frameworks.push('Vue');
        if (allDeps.angular || allDeps['@angular/core']) analysis.frameworks.push('Angular');
        if (allDeps.express) analysis.frameworks.push('Express');
        if (allDeps.next) analysis.frameworks.push('Next.js');
        if (allDeps.svelte) analysis.frameworks.push('Svelte');
      } catch (err) {
        // Ignore parse errors
      }
    }

    return {
      success: true,
      repoKey,
      ...analysis
    };
  }

  /**
   * Get OpenAI tool definitions
   */
  getTools() {
    return [
      {
        name: 'clone_repo',
        handler: (args) => this.cloneRepo(args.git_url, args.branch || 'main'),
        definition: {
          type: 'function',
          function: {
            name: 'clone_repo',
            description: 'Clone a Git repository for analysis. Supports GitHub, GitLab, Bitbucket URLs. Returns a repoKey to use in other code tools.',
            parameters: {
              type: 'object',
              properties: {
                git_url: {
                  type: 'string',
                  description: 'Full Git repository URL (e.g., https://github.com/user/repo.git)'
                },
                branch: {
                  type: 'string',
                  description: 'Branch to clone (default: main)'
                }
              },
              required: ['git_url']
            }
          }
        }
      },
      {
        name: 'list_repo_files',
        handler: (args) => this.listRepoFiles(args.repo_key, args.extensions || [], args.max_depth || 5),
        definition: {
          type: 'function',
          function: {
            name: 'list_repo_files',
            description: 'List all files in a cloned repository. Can filter by file extensions.',
            parameters: {
              type: 'object',
              properties: {
                repo_key: {
                  type: 'string',
                  description: 'Repository key returned from clone_repo'
                },
                extensions: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Filter by file extensions (e.g., ["js", "py"]). Leave empty for all files.'
                },
                max_depth: {
                  type: 'number',
                  description: 'Maximum directory depth to traverse (default: 5)'
                }
              },
              required: ['repo_key']
            }
          }
        }
      },
      {
        name: 'read_code_file',
        handler: (args) => this.readCodeFile(args.repo_key, args.file_path),
        definition: {
          type: 'function',
          function: {
            name: 'read_code_file',
            description: 'Read the full contents of a specific file in the repository.',
            parameters: {
              type: 'object',
              properties: {
                repo_key: {
                  type: 'string',
                  description: 'Repository key from clone_repo'
                },
                file_path: {
                  type: 'string',
                  description: 'Relative path to the file within the repo (e.g., "src/index.js")'
                }
              },
              required: ['repo_key', 'file_path']
            }
          }
        }
      },
      {
        name: 'search_code',
        handler: (args) => this.searchCode(
          args.repo_key,
          args.search_term,
          args.extensions || [],
          args.case_sensitive || false,
          args.max_results || 50
        ),
        definition: {
          type: 'function',
          function: {
            name: 'search_code',
            description: 'Search for a text pattern across all files in the repository. Returns matching files with line numbers and context.',
            parameters: {
              type: 'object',
              properties: {
                repo_key: {
                  type: 'string',
                  description: 'Repository key from clone_repo'
                },
                search_term: {
                  type: 'string',
                  description: 'Text to search for (function names, classes, keywords, etc.)'
                },
                extensions: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Limit search to specific file types (e.g., ["js", "ts"])'
                },
                case_sensitive: {
                  type: 'boolean',
                  description: 'Whether search is case-sensitive (default: false)'
                },
                max_results: {
                  type: 'number',
                  description: 'Maximum number of files to return (default: 50)'
                }
              },
              required: ['repo_key', 'search_term']
            }
          }
        }
      },
      {
        name: 'analyze_structure',
        handler: (args) => this.analyzeStructure(args.repo_key),
        definition: {
          type: 'function',
          function: {
            name: 'analyze_structure',
            description: 'Analyze the project structure to detect languages, frameworks, dependencies, and config files.',
            parameters: {
              type: 'object',
              properties: {
                repo_key: {
                  type: 'string',
                  description: 'Repository key from clone_repo'
                }
              },
              required: ['repo_key']
            }
          }
        }
      }
    ];
  }

  /**
   * Execute a tool by name
   */
  async executeTool(toolName, args) {
    const tool = this.getTools().find(t => t.name === toolName);
    if (!tool) {
      throw new Error(`Unknown code tool: ${toolName}`);
    }
    return tool.handler(args);
  }
}

module.exports = CodeAgent;
