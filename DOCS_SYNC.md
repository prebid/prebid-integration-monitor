# Agent Documentation Synchronization

This project maintains synchronized documentation across multiple AI agent instruction files to ensure consistency and avoid confusion.

## Overview

The agent documentation system ensures that critical information is kept in sync across:
- `CLAUDE.md` - Claude AI specific instructions
- `GEMINI.md` - Google Gemini specific instructions  
- `AGENTS.md` - Universal AI agent guidelines

## Automated Synchronization

### Scripts Available

```bash
# Sync all agent documentation files
npm run sync-agent-docs

# Validate documentation consistency
npm run validate-docs

# Setup git pre-commit hook for auto-sync
npm run setup-git-hook

# Get documentation status report
npm run docs-status
```

### What Gets Synchronized

The following sections are automatically kept in sync across all agent files:

- **Build Protocol** - Critical TypeScript compilation steps
- **Testing Commands** - Standard test procedures  
- **Flag Reference** - CLI flag documentation
- **Common Commands** - Copy-paste ready commands
- **Troubleshooting** - Common issues and solutions
- **Success Indicators** - Validation checkpoints

### Agent-Specific Content

Each agent file retains unique sections tailored to that AI:

**CLAUDE.md**:
- Development workflow specifics
- Error pattern recognition
- Claude-specific best practices

**GEMINI.md**:
- Gemini development workflow
- Common pitfalls for AI agents
- Code generation guidelines

**AGENTS.md**:
- Universal best practices
- Cross-platform compatibility
- Testing checklist

## Automation Features

### Git Hook Integration

```bash
# Install pre-commit hook
npm run setup-git-hook
```

Once installed, documentation will automatically sync before every commit.

### GitHub Actions

The project includes a GitHub Actions workflow (`.github/workflows/sync-docs.yml`) that:

- **On Push**: Automatically syncs and commits documentation updates
- **On Pull Request**: Validates consistency and comments if sync needed
- **Triggers**: When source files or documentation files change

### Validation

```bash
# Check if all files are consistent
npm run validate-docs
```

This validates:
- All required files exist
- Shared sections are present in all files
- Content consistency across agent files

## Manual Workflow

### When Making Changes

1. **Edit source files** (scan-options.ts, scan.ts, etc.)
2. **Run sync**: `npm run sync-agent-docs`
3. **Validate**: `npm run validate-docs`
4. **Commit all changes** including updated documentation

### Adding New Shared Content

To add new shared content across all agent files:

1. Edit `scripts/sync-agent-docs.js`
2. Add new section to `SHARED_SECTIONS` object
3. Run `npm run sync-agent-docs`
4. All agent files will be updated automatically

### Adding Agent-Specific Content

To add content specific to one agent:

1. Edit the agent-specific section in `generateAgentContent()`
2. Add conditional logic for the specific agent file
3. Run sync to update that file only

## File Structure

```
project-root/
├── CLAUDE.md                    # Claude-specific instructions
├── GEMINI.md                    # Gemini-specific instructions  
├── AGENTS.md                    # Universal agent guidelines
├── DOCS_SYNC.md                 # This documentation
├── scripts/
│   └── sync-agent-docs.js       # Synchronization script
├── .github/workflows/
│   └── sync-docs.yml            # GitHub Actions workflow
└── .agent-docs-status.json      # Status report (generated)
```

## Status Monitoring

The sync script generates a status report at `.agent-docs-status.json` containing:

- File existence and modification times
- File sizes
- Number of shared sections
- Last synchronization timestamp

## Best Practices

### For Developers

1. **Always run sync after source changes** that affect CLI or functionality
2. **Use validation** to ensure consistency before commits
3. **Install git hook** for automatic synchronization
4. **Check status reports** to monitor documentation health

### For AI Agents

1. **Reference the appropriate file** for your platform (CLAUDE.md, GEMINI.md, etc.)
2. **Check documentation freshness** - files should be recently synchronized
3. **Use shared commands** exactly as documented for consistency
4. **Follow platform-specific guidelines** in addition to shared content

## Troubleshooting

### Documentation Out of Sync

```bash
# Force re-sync all files
npm run sync-agent-docs

# Check what's different
npm run validate-docs
```

### Git Hook Not Working

```bash
# Reinstall the hook
npm run setup-git-hook

# Check hook exists
ls -la .git/hooks/pre-commit
```

### CI/CD Failures

Check that:
- All agent files are committed
- No merge conflicts in documentation
- Scripts are executable: `chmod +x scripts/sync-agent-docs.js`

## Integration with Development Workflow

The documentation sync integrates seamlessly with the development workflow:

1. **Feature Development** → Edit TypeScript source files
2. **Build Process** → `npm run build` compiles changes
3. **Documentation Sync** → `npm run sync-agent-docs` updates all agent files
4. **Validation** → `npm run validate-docs` ensures consistency
5. **Commit** → Git hook auto-syncs (if installed)
6. **CI/CD** → GitHub Actions validates and syncs on push/PR

This ensures that agent documentation is always accurate and up-to-date with the latest code changes, preventing confusion and ensuring AI agents have access to current information.