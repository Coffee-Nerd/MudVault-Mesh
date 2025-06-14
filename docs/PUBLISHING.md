# Publishing MudVault Mesh Client Libraries

This document outlines the process for publishing the MudVault Mesh client libraries to npm and PyPI.

## Overview

The MudVault Mesh project consists of:
- **Gateway Server**: The main repository (this repo) that runs on mesh.mudvault.org
- **Client Libraries**: Standalone packages that MUD developers install to connect to the mesh

## Client Packages

### Node.js Package: `mudvault-mesh`
- **Purpose**: For MUDs written in Node.js/JavaScript/TypeScript
- **Registry**: npm
- **Location**: `packages/nodejs/`

### Python Package: `mudvault-mesh`
- **Purpose**: For MUDs written in Python
- **Registry**: PyPI
- **Location**: `packages/python/`

## Prerequisites

### For npm Publishing
1. **npm account**: Create account at https://www.npmjs.com
2. **npm CLI**: Ensure npm is installed and updated
3. **Authentication**: Log in with `npm login`

### For PyPI Publishing
1. **PyPI account**: Create account at https://pypi.org
2. **Build tools**: Install build and twine
3. **Authentication**: Configure PyPI credentials

## Publishing Process

### Node.js Package (npm)

#### 1. Prepare the Package
```bash
cd packages/nodejs

# Install dependencies
npm install

# Build TypeScript
npm run build

# Run linting (optional)
npm run lint

# Verify package contents
npm pack --dry-run
```

#### 2. Test Locally (Optional)
```bash
# Test in another directory
cd /tmp
npm pack /path/to/packages/nodejs
npm install mudvault-mesh-1.0.0.tgz
node -e "const {MeshClient} = require('mudvault-mesh'); console.log('Package works!');"
```

#### 3. Publish to npm
```bash
cd packages/nodejs

# Login to npm (first time only)
npm login

# Publish package
npm publish

# Verify publication
npm view mudvault-mesh
```

#### 4. Post-Publishing
```bash
# Test installation
npm install mudvault-mesh

# Check package page
# Visit: https://www.npmjs.com/package/mudvault-mesh
```

### Python Package (PyPI)

#### 1. Prepare the Package
```bash
cd packages/python

# Install build tools (if not installed)
python3 -m pip install --user build twine

# Validate package structure
python3 -c "import mudvault_mesh; print('Package structure OK')"
```

#### 2. Build the Package
```bash
# Clean previous builds
rm -rf dist/ build/ *.egg-info/

# Build the package
python3 -m build

# Verify build outputs
ls -la dist/
```

#### 3. Test the Build (Optional)
```bash
# Install locally for testing
python3 -m pip install dist/mudvault_mesh-1.0.0-py3-none-any.whl

# Test import
python3 -c "from mudvault_mesh import MeshClient; print('Package works!');"
```

#### 4. Publish to PyPI
```bash
# Upload to PyPI
python3 -m twine upload dist/*

# If first time, you'll be prompted for PyPI credentials
# Username: your-pypi-username
# Password: your-pypi-password (or API token)
```

#### 5. Post-Publishing
```bash
# Test installation
python3 -m pip install mudvault-mesh

# Check package page
# Visit: https://pypi.org/project/mudvault-mesh/
```

## Version Management

### Updating Versions

#### Node.js Package
```bash
cd packages/nodejs

# Update version in package.json
npm version patch  # or minor, major

# Rebuild
npm run build

# Publish
npm publish
```

#### Python Package
```bash
cd packages/python

# Update version in pyproject.toml
# Edit: version = "1.0.1"

# Rebuild and publish
python3 -m build
python3 -m twine upload dist/*
```

### Version Strategy
- **patch**: Bug fixes (1.0.0 → 1.0.1)
- **minor**: New features, backward compatible (1.0.0 → 1.1.0)  
- **major**: Breaking changes (1.0.0 → 2.0.0)

## Security Considerations

### API Tokens (Recommended)
Instead of passwords, use API tokens:

#### npm
```bash
# Create token at https://www.npmjs.com/settings/tokens
npm login --auth-type=token
```

#### PyPI
```bash
# Create token at https://pypi.org/manage/account/token/
# Use token as password with username: __token__
```

### Package Verification
Always verify published packages:
```bash
# npm
npm view mudvault-mesh

# PyPI  
python3 -m pip show mudvault-mesh
```

## Troubleshooting

### Common npm Issues

#### "Package already exists"
```bash
# Check if version already published
npm view mudvault-mesh versions --json

# Update version and try again
npm version patch
npm publish
```

#### "Authentication failed"
```bash
# Re-login
npm logout
npm login

# Check authentication
npm whoami
```

### Common PyPI Issues

#### "File already exists"
```bash
# Update version in pyproject.toml
# Rebuild package
python3 -m build
python3 -m twine upload dist/*
```

#### "Invalid authentication"
```bash
# Check credentials
python3 -m twine upload --verbose dist/*

# Use API token instead of password
```

### Build Issues

#### Node.js TypeScript Errors
```bash
# Fix TypeScript errors
npm run typecheck

# Rebuild
npm run build
```

#### Python Import Errors
```bash
# Check package structure
python3 -c "import mudvault_mesh"

# Verify __init__.py files exist
find mudvault_mesh -name "__init__.py"
```

## CI/CD Integration (Future)

### GitHub Actions for Automated Publishing

Create `.github/workflows/publish.yml`:

```yaml
name: Publish Packages

on:
  push:
    tags:
      - 'v*'

jobs:
  publish-npm:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
          registry-url: 'https://registry.npmjs.org'
      - run: cd packages/nodejs && npm ci
      - run: cd packages/nodejs && npm run build
      - run: cd packages/nodejs && npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

  publish-pypi:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-python@v4
        with:
          python-version: '3.x'
      - run: python -m pip install build twine
      - run: cd packages/python && python -m build
      - run: cd packages/python && python -m twine upload dist/*
        env:
          TWINE_USERNAME: __token__
          TWINE_PASSWORD: ${{ secrets.PYPI_TOKEN }}
```

## Package Usage Examples

### Node.js
```javascript
const { MeshClient } = require('mudvault-mesh');

const client = new MeshClient('MyMUD');
await client.connect(); // Connects to mesh.mudvault.org
```

### Python
```python
from mudvault_mesh import MeshClient

client = MeshClient('MyMUD')
await client.connect()  # Connects to mesh.mudvault.org
```

## Support

For publishing issues:
- **npm**: https://docs.npmjs.com/cli/v9/commands/npm-publish
- **PyPI**: https://packaging.python.org/en/latest/tutorials/packaging-projects/
- **GitHub Issues**: https://github.com/Coffee-Nerd/OpenIMC/issues
- **Discord**: https://discord.gg/r6kM56YrEV