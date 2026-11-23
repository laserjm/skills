---
name: change-solution-path
description: Turn a feature idea, improvement, or bug into a confident, simple solution path by mapping the code it touches, asking what you know, then auditing.
disable-model-invocation: true
argument-hint: <feature / improvement / bug description>
metadata:
  version: "1"
---

The deliverable is a **solution path**: a plan the user approves before any code changes. This skill ends at the plan.

## The standard

Every step below serves this brief from the user:

> I want you to solve this in a way that is both simple in its implementation and not confusing to users when they try to use it.

## 1. Intake

The change is: $ARGUMENTS

If that is empty, ask for the feature idea, improvement, or bug description and wait. Done when you hold a description of the change.

## 2. Reconnaissance

A quick code review that maps the change's **blast radius**: the interfaces it could alter and the code that depends on them. Read for shape; pinning down the **starting point** (a bug's root cause, or the seam where a feature attaches) belongs to the audit.

Search the codebase for the names, behaviours, and messages in the change, and build the map:

- **Entry points**: where the described behaviour lives or would live, at `file:line`.
- **Interfaces**: the contracts those entry points expose or consume: function and type signatures, API routes, schemas, CLI flags, config keys, events, and the UI the user sees.
- **Dependents**: one hop out from each interface: its callers, importers, and consumers, plus the tests that cover it.

Done when every area the change names is located or recorded as not found, and every interface lists its direct dependents.

## 3. One question set

Open the message with the blast radius as a short list, so the user can correct it. Then write one set of questions generated from the change and the map:

- **The user's view**: their opinion, what they already know (suspected cause, prior attempts, related features), the goal behind the change, and the outcome they expect.
- **Scope**: the decisions the map surfaces that only the user can make, each naming its interface or dependent at `file:line`: which dependents keep today's behaviour, whether an interface may change shape, where the change stops.

Ask only what the code cannot answer. Ask them all in one message, tell the user any or all can be skipped, and wait for the reply.

This is the only round of questions. Take whatever comes back, including an empty reply, and carry it into the audit as the user's expectations, together with the map as the user corrected it. Done when the user has replied.

## 4. Audit

> I want you to do a thorough audit of the current implementation. If you see a simple path to solve the problem, stop and let me know. Come back when you have a confident path to a solution to the problem with a good experience for our users.

Start from the blast radius. Two exits:

- **Simple path**: the moment a simple change is clear, stop auditing and go to the report.
- **Confident path**: otherwise keep digging. You are confident when every code path the change touches has been read, the starting point is named at `file:line`, each part of the change is grounded in code you have seen, and every dependent of an interface the change alters has been checked.

Check the path against the standard and the user's answers: the smallest change that solves it, and what the user sees or does afterwards reads as obvious to them.

## 5. Report

Bring back:

- **Starting point**: what it is and where (`file:line`).
- **Path**: the changes, in order, each with its file.
- **Blast radius**: each interface the path alters, its dependents, and how each keeps working, or the break the user accepted.
- **User experience**: what using it looks like after the change.
- **Against your expectations**: where the path matches or departs from what the user said in step 3, and why.
- **Open questions**: anything only the user can decide.

Then wait for the user's go before implementing.
