---
name: issue-solution-path
description: Turn an issue, idea, or bug report into a confident, simple solution path by asking what you know, then auditing the code.
disable-model-invocation: true
argument-hint: <issue / idea / bug description>
---

The deliverable is a **solution path**: a plan the user approves before any code changes. This skill ends at the plan.

## The standard

Every step below serves this brief from the user:

> I want you to solve this in a way that is both simple in its implementation and not confusing to users when they try to use it.

## 1. Intake

The issue is: $ARGUMENTS

If that is empty, ask for the intro, idea, issue, or bug description and wait. Done when you hold a description of the problem.

## 2. One question set

Write one set of questions generated from the issue, drawing out the user's view: their opinion, what they already know (suspected cause, affected area, prior attempts), the goal behind the issue, and the outcome they expect. Ask them all in one message, tell the user any or all can be skipped, and wait for the reply.

This is the only round of questions. Take whatever comes back, including an empty reply, and carry it into the audit as the user's expectations. Done when the user has replied.

## 3. Audit

> I want you to do a thorough audit of the current implementation. If you see a simple path to solve the problem, stop and let me know. Come back when you have a confident path to a solution to the problem with a good experience for our users.

Two exits:

- **Simple path**: the moment a simple fix is clear, stop auditing and go to the report.
- **Confident path**: otherwise keep digging. You are confident when every code path the issue touches has been read, the root cause is named at `file:line`, and each part of the fix is grounded in code you have seen.

Check the path against the standard and the user's answers: the smallest change that solves it, and what the user sees or does afterwards reads as obvious to them.

## 4. Report

Bring back:

- **Root cause**: what is happening and where (`file:line`).
- **Path**: the changes, in order, each with its file.
- **User experience**: what using it looks like after the fix.
- **Against your expectations**: where the path matches or departs from what the user said in step 2, and why.
- **Open questions**: anything only the user can decide.

Then wait for the user's go before implementing.
