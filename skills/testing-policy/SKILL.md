---
name: testing-policy
description: Contract testing policy. Use when choosing coverage for a critical user workflow, public API/action/mutation, deep module, or business-critical calculation.
---

# Testing Policy

Protect product **contracts** at the highest useful **seam**. A contract is behaviour visible to a user or caller; a workflow test crosses the same interface and is the durable test surface for a deep module.

## Choose the test surface

Classify each changed product contract and give it one primary test surface. Add a test only when it protects a distinct contract risk that the primary surface cannot demonstrate.

| Contract | Primary test surface | Observable result |
| --- | --- | --- |
| A critical user journey crossing persistence or more than one module | Automated workflow | The user can complete the journey and observe its durable outcome after reload or from the next product surface. |
| A public API, server action, RPC, or mutation | Interface integration | The authenticated caller receives the documented success or failure and can retrieve the resulting durable state through the module interface. |
| A business-critical calculation or rule not fully demonstrated at a higher seam | Direct module interface | Known inputs produce an independently derived, known result. |
| Agreement between two real adapters of a deep module | Shared interface fixtures | Every adapter produces the same result for each fixture. |

Keep test setup behind the module interface. Test code is a caller: it must not reach through a deep module into its implementation or database tables to establish a result.

## Critical workflows

Call a workflow critical when it changes durable user meaning, authorizes access or entitlement, commits money, or requires agreement across product surfaces. Make every named critical workflow executable in CI. Express one scenario in terms of the user-visible capability, stable product data, and its expected durable outcome. Keep its test narrow enough to identify the failed capability.

When a workflow has a manual specification, use it as the product-language source of truth. Create an automated counterpart for each executable critical case, and update both when the workflow's meaning changes. Record an environment prerequisite beside a case when it prevents automation. A case that only repeats a protected workflow belongs in its existing scenario.

## APIs, actions, and mutations

Give every new or materially changed public write interface an integration test through its public interface, using the local authenticated environment and real persistence when the interface owns durable state. When a workflow is the primary surface, use this test for an interface-owned risk the workflow does not show. Establish the applicable contract facts:

1. The valid request and observable success result.
2. The most consequential rejected request: an invariant, authorization, validation, or plan rule the interface owns.
3. Atomicity when one logical update replaces or coordinates a set of data: a rejected request preserves the prior complete state.

Cover read interfaces when their result is the contract that enables a critical workflow, authorization decision, or business rule. Use stable fixtures and assert the caller-visible shape and meaning, not calls to internal collaborators.

## Calculations and deep modules

Test a calculation directly only when it carries business-critical meaning that is not already clear at a higher seam: financial values, eligibility or plan decisions, ranking, scoring, or a rule whose error would harm users. Place tests at the owning module's interface, use literal worked examples or another independent source of truth, and name the business rule.

For a deep module, concentrate tests at its small interface. Internal helpers are implementation details; they earn a direct test only when they are themselves a business-critical calculation or have an internal seam needed to make the module reliable.

When the module has two real adapters, use one shared fixture set at the interface and require adapter parity. Do not introduce an adapter only to make testing easier.

## Completion criterion

Before declaring a change tested, name every changed product contract and its one primary test surface. Retain or add another test only for a distinct contract risk absent from that surface. The selected tests must be runnable by the repository's automated test command and fail when the protected contract regresses.
