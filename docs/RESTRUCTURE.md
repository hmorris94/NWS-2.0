# Restructuring a Flat Python Project into a Package

A guide for reorganizing a Python project that has outgrown its flat-file layout. Written for Claude Code agents to follow when restructuring a codebase for GitHub readiness.

## When to Restructure

The root directory should communicate project structure at a glance. Restructure when:

- Root has more than ~6 Python files and it's unclear which is the entry point
- Templates, static assets, and source modules are all siblings at root
- Planning docs, design docs, or changelogs clutter the root alongside code
- Redundant entry points exist (e.g. `serve.py` that duplicates `main.py web`)

## Principles

1. **One entry point at root.** The root should have exactly one Python file a user runs directly. Everything else is internal.
2. **Group by role, not by type.** Put source modules alongside the templates and static files they serve, not in separate sibling directories.
3. **User-facing data stays at root.** Directories the user interacts with directly (`data/`, `uploads/`, `output/`) remain at root level.
4. **Docs get their own directory.** Planning docs, design docs, ADRs, and changelogs belong in `docs/`, not root.
5. **Don't rename during restructuring.** Move files first, rename later (if at all). Combining moves and renames makes verification harder.

## Choosing a Package Name

| Package name | When to use |
|---|---|
| `app/` | Flask/web projects. Conventional, instantly recognizable. Bonus: if `app.py` exported `app`, then `from app import app` still works after the move. |
| `src/` | General-purpose projects, non-web CLIs, libraries. Neutral and widely understood. |
| `lib/` | When `src/` feels too broad and the code is utility-focused. |
| `<project_name>/` | When the project will be pip-installed or published to PyPI. Required for proper packaging. Avoid if the repo directory is already named the same thing — `my-project/my_project/` reads as redundant. |

For most small-to-medium projects that won't be published as packages, `app/` (web) or `src/` (non-web) is the right choice.

## Target Layout

```
project/
├── main.py              # The one entry point
├── app/                 # All source code (or src/ for non-web projects)
│   ├── __init__.py      # Package init (app factory for Flask projects)
│   ├── routes.py        # Route definitions
│   ├── models.py        # Data models / business logic
│   ├── services.py      # External integrations
│   ├── templates/       # Jinja2 templates (Flask/web)
│   └── static/          # CSS, JS, images (Flask/web)
├── data/                # User-facing data (gitignored)
├── docs/                # Planning docs, design docs
├── requirements.txt     # (or pyproject.toml)
├── README.md
├── CLAUDE.md
└── .gitignore
```

## Step-by-Step Migration

### 1. Audit cross-references

Before moving anything, map every import and file path reference in the project. Search for:

```
# Python imports between project files
grep -rn "^from \|^import " *.py

# File/directory path strings
grep -rn "data/" *.py
grep -rn "templates" *.py
grep -rn "static" *.py

# Lazy imports inside functions (easy to miss)
grep -rn "    from \|    import " *.py
```

Categorize each reference as:
- **Cross-module import** — will need a relative import (`.module`) or package-qualified import (`app.module`)
- **CWD-relative data path** (e.g. `"data/output.json"`) — convert to `__file__`-based resolution in Step 5
- **Module-relative path** (e.g. Flask's `template_folder="templates"`) — no change needed if templates move alongside the module

### 2. Resolve naming conflicts

If a file and directory would share the same name (e.g. `app.py` and `app/`), the file must be deleted before creating the directory. Plan this in your execution order.

On the contents: `app.py` typically becomes `app/__init__.py` with its bare imports converted to relative imports:

```python
# Before (app.py):
from routes import create_blueprint

# After (app/__init__.py):
from .routes import create_blueprint
```

### 3. Create the package and copy files

Create the package directory, `__init__.py`, and copy/move all source files into it. For files that only import stdlib or third-party modules, copy them unchanged — no edits needed.

### 4. Update imports

There are three categories. Handle them systematically:

**A. Entry point → package (absolute imports gain prefix):**
```python
# main.py before:
from models import Thing
from services import Client

# main.py after:
from app.models import Thing
from app.services import Client
```

**B. Package init (bare imports become relative):**
```python
# app/__init__.py:
from .routes import create_blueprint   # was: from routes import
```

**C. Internal cross-references (bare imports become relative):**
```python
# app/routes.py:
from .models import Thing             # was: from models import
from .services import Client          # was: from services import
```

**D. Leaf modules — no change.** If a module only imports `json`, `os`, `flask`, `requests`, etc., don't touch it.

**E. Lazy imports inside functions — easy to miss:**
```python
def some_handler():
    from .integrations import Client  # was: from integrations import
```
Search for indented `from`/`import` statements to find these.

### 5. Resolve data paths

After restructuring, source modules live one level deeper (`app/blueprint.py` vs `blueprint.py`). Data directories stay at the project root (Principle 3). The modules need a reliable way to find them.

**Don't rely on CWD.** A bare `"data/output.json"` resolves relative to wherever the process starts. This works when the user runs `python main.py` from the project root, but breaks when:

- The project is loaded as a component by another host (e.g. a gateway server)
- A user runs it from a parent or sibling directory
- Tests run from a different working directory

**Use `__file__` to build absolute paths to project directories:**

```python
# app/blueprint.py (or app/routes.py, etc.)
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent  # app/blueprint.py → app/ → project/

DEFAULT_CONFIG = {
    "data_dir": str(PROJECT_ROOT / "data"),
}
```

**Accept config overrides** so an external host can substitute a different path if needed:

```python
def create_blueprint(name="myapp", config=None):
    cfg = {**DEFAULT_CONFIG, **(config or {})}
    cache = DataCache(cfg["data_dir"])
```

The project works standalone (defaults resolve correctly) and as a component (host can override).

**Summary:**

| Path type | Resolve via | Example | Change needed? |
|---|---|---|---|
| Project data dirs | `__file__` traversal | `PROJECT_ROOT / "data"` | Yes — convert from CWD-relative |
| Flask template/static | Module-relative (automatic) | `template_folder="templates"` | No — moves with the module |
| User-specified paths | CWD or argument | CLI `--input file.csv` | No — caller's responsibility |

### 6. Move non-code files

- Planning/design docs → `docs/`
- Delete redundant entry points (e.g. `serve.py` if `main.py web` does the same thing)
- Delete stale `__pycache__/` directories at old locations
- Delete any artifacts (e.g. Windows `nul` files, `.gitkeep` files in directories that no longer exist at root)

### 7. Update documentation

Every file that references source paths needs updating:

- **README.md** — project structure tree, troubleshooting references to file paths
- **CLAUDE.md** — module listings, architecture section, key files
- **.gitignore** — usually no changes (`__pycache__/` matches at any depth, `data/` stays at root)
- **CI/CD configs** — any workflow files referencing source paths
- **Memory files** — if using Claude Code's auto-memory, update file path references

### 8. Verify everything works

Run through this checklist:

```bash
# Package imports
python -c "from app import <main_export>"
python -c "from app.<module> import <class>"

# Entry point
python main.py --help

# Every subcommand (if CLI)
python main.py <each_subcommand>

# Web server (if applicable)
python main.py web
# Then hit every page and verify:
#   - Pages render without errors
#   - Static files (CSS, JS) load (no 404s)
#   - API endpoints return data
#   - Interactive features work (forms, AJAX, etc.)

# Data paths resolve
# Verify that read/write operations still target the correct directories
```

## Common Pitfalls

**Lazy imports inside functions.** These fail at runtime, not startup. A `python -c "from app import app"` won't catch them. Grep for indented import statements and test the actual code paths.

**Relative imports require `__init__.py`.** The `from .module import X` syntax only works inside a Python package. If `__init__.py` is missing, you'll get `ImportError: attempted relative import with no known parent package`.

**Circular imports.** Moving to relative imports can surface circular dependencies that were previously hidden. If `A` imports `B` and `B` imports `A`, you'll get an `ImportError`. Fix by moving the shared dependency into a third module, or by deferring one import inside a function.

**Multiple `__init__.py` side effects.** If `__init__.py` creates objects (like a Flask app) at import time, be aware that `from app.models import X` will trigger `__init__.py` and create the app as a side effect. This is usually fine but can cause issues in testing or when importing individual modules.

**Don't over-nest.** One level of packaging (`app/`) is almost always sufficient. Don't create `app/web/`, `app/core/`, `app/utils/` unless you have 15+ modules. Premature sub-packaging creates navigation overhead without organizational benefit.
