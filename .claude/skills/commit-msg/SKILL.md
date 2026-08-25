---
name: commit-msg
description: Generate a conventional commit message from the currently staged diff and commit with it. Use when the user says "write a commit message", "generate a commit", "commit my changes", or runs /commit-msg.
---

# commit-msg

Generate a commit message from staged changes and commit them.

## Steps

1. Run `git diff --staged --stat` (or plain `git diff --staged`) to check for staged changes.
   - If there is no staged diff (empty output), **stop** and tell the user: "Nothing is staged. Run `git add` on the files you want to commit first." Do not proceed, do not stage anything yourself.
2. Read the full staged diff with `git diff --staged`.
3. From the diff, write a commit message in this exact format:

   ```
   type(scope): short subject

   - bullet of what changed
   - bullet of why
   ```

   - `type` is one of: `feat`, `fix`, `refactor`, `chore`, `docs`, `style`, `test`. Pick the one that best matches the actual change (e.g. `fix` for a bug fix, `refactor` for restructuring with no behavior change, `docs` for documentation-only changes).
   - `scope` is a short identifier for the affected area (e.g. a directory, module, or feature name inferred from the changed file paths). Omit the `(scope)` parens entirely if no single scope fits.
   - `subject` is imperative mood, lowercase after the colon, no trailing period, and **under 60 characters** total for the `type(scope): subject` line.
   - Body bullets are optional but encouraged — include them when there's more than one logical change or when the "why" isn't obvious from the subject alone. Keep bullets concise; omit the body entirely for trivial one-line changes.
   - **Never** include a `Co-Authored-By` trailer or any other trailer.
4. Commit with the message, passed via a HEREDOC so multi-line messages with bullets are passed correctly, rather than chaining multiple `-m` flags:

   ```
   git commit -m "$(cat <<'EOF'
   <message>
   EOF
   )"
   ```

5. Check the exit status of the commit.
   - If it succeeded, confirm it (e.g. show the resulting `git log -1 --stat` or the commit hash) and report it back concisely.
   - If it failed (e.g. a pre-commit hook rejected it), read the hook's output, fix the underlying issue, re-stage the fixed files, and create a **new** commit with the same message — do not amend, and do not bypass the hook with `--no-verify`. If the failure isn't something you can fix directly, stop and report the hook output to the user.

## Notes

- Do not stage additional files — only commit what's already staged.
- Do not amend existing commits; always create a new commit.
- Do not push.
