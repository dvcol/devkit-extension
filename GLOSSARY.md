# Glossary

Canonical vocabulary for the portable contribution ecosystem. Behavior and contracts are defined in [ARCHITECTURE.md](./ARCHITECTURE.md). The [decision history](./docs/planning/005-decisions.md) records the owner review; earlier proposal packets are historical.

## Definitions and behavior

| Term                   | Definition                                                                                                                            | Distinction                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Capability             | A declared backend service contract offered by a provider, consisting of named operations                                             | A contract does not imply a currently available implementation                       |
| Capability descriptor  | An imported definition containing the capability ID, mandatory numeric contract version and operation schemas                         | Separate from a service definition or running service                                |
| Contract version       | A numeric revision of a public contract, matched exactly                                                                              | Separate from a package release version; no inferred semver compatibility            |
| Operation              | A named method in a capability contract, with input and return schemas and an explicit target requirement                             | It can be called directly without an action wrapper                                  |
| Invocation request     | One call containing its imported capability/operation or action descriptor, business input and execution metadata                     | Separate from a reusable declaration, selected provider binding or broadcast result  |
| Action descriptor      | The public, versioned contract for an invocable use case, created by `defineActionContract`                                           | Safe for clients to import without its handler                                       |
| Action contribution    | A packaged handler created by `defineAction`, implementing an action descriptor with execution assignment and capability requirements | May compose several operations; does not replace capabilities                        |
| Contribution           | An addition supplied by a plugin, such as a service, action, view, transform or script                                                | Shared terminology and ownership rules, not a mandatory mixed array                  |
| Contribution kind      | The category determining a contribution's declaration shape and activation behavior                                                   | Built-in kinds have dedicated plugin properties                                      |
| Extension contribution | A declaration carrying an imported custom-kind descriptor and a validated payload                                                     | Extends the model without arbitrary plugin keys or a closed kind switch              |
| Service definition     | An inert recipe created by `defineService`, implementing a mandatory capability contract                                              | The same recipe type is used for startup and runtime installation                    |
| Plugin                 | A named composition of contribution definitions installed and controlled together                                                     | Neither a browser extension nor a provider; its contributions can fail independently |
| Definition helper      | A function preserving declaration types and checking declarative invariants                                                           | Does not install a service, register a listener or start a runtime                   |

## Hosting and execution

| Term                      | Definition                                                                                           | Distinction                                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Host                      | The application composing providers, clients, adapters and policy                                    | Can use several realms and providers concurrently                                               |
| Provider                  | An identifiable owner offering contracts, operation execution and separate state                     | Multiple providers can offer the same capability                                                |
| Provider ID               | A stable logical identity configured by the embedding host for a provider                            | Preserves selection across backend recreation; does not authenticate an endpoint                |
| Provider incarnation      | An opaque identity for one lifetime of that provider's backend runtime                               | Changes on backend recreation, not ordinary UI HMR or reconnect to the same running backend     |
| Discovery registry        | The client composition root's owned collection of provider connections and their advertised metadata | Coordinates discovery for consumers; does not merge provider state or create another RPC engine |
| Realm                     | An extensible environment family, initially `webext` or `devserver`                                  | Devframe and Vite are integrations within a realm, not mutually exclusive realm families        |
| Provider runtime          | The role responsible for admission, activation and authoritative operation execution                 | May integrate into an existing native host rather than require a new runtime constructor        |
| Client runtime            | The role responsible for discovery, selection, subscriptions, calls and presentation bindings        | May run without owning the provider's native resources                                          |
| Execution context         | The actual process, worker or document where code and native resources belong                        | Distinct from provider identity, realm and UI placement                                         |
| Execution agent           | Target-scoped code performing delegated work for a provider in another execution                     | A content/page script does not automatically become an independently trusted provider           |
| Adapter                   | Code integrating portable contracts with an environment's lifecycle, resources and communication     | Broader than a transport; server adapters reuse existing Devframe/Vite machinery                |
| Transport                 | The channel carrying protocol messages                                                               | Does not by itself implement capabilities or render UI                                          |
| Native context            | The actual environment/library resources owned by a local execution                                  | Remote metadata cannot contain native handles                                                   |
| Native context descriptor | An imported key associating a local context resource with its type                                   | Presence is checked separately from a realm label                                               |

## Ownership and lifecycle

| Term                | Definition                                                                                    | Distinction                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Admission batch     | Definitions inspected together before any setup in that batch runs                            | Strict admission failure rejects the entire batch, preserving earlier installations               |
| Registration        | An admitted, owned declaration in a provider registry                                         | Admission does not guarantee successful or currently eligible activation                          |
| Service slot        | A provider's registration identity for one capability ID and exact contract version           | Different versions can coexist; repeated references to the same definition still conflict         |
| Installation handle | A local control and observation object for one admitted service or plugin installation        | Not a service API and not a shared ownership lease                                                |
| Activation          | One live generation of a contribution's executable registrations and owned resources          | Capability restoration can create a new generation without reinstalling its declaration           |
| Activation scope    | The owner of resources created during one activation                                          | Ends before a replacement activation can begin                                                    |
| Capability binding  | A consumer's typed API and context for a resolved provider implementation                     | Gives access, not installation ownership or permanent availability                                |
| Requirement         | A declared capability dependency that must be bound before activation                         | Does not grant permissions or route different dependencies implicitly to different providers      |
| Availability        | Whether a contract can currently be used for the relevant execution and target                | Distinguishes unsupported implementation, missing permission, unavailable target and other causes |
| Setup failure       | Failure while activating an admitted declaration                                              | Isolated from independent contributions; requires explicit retry                                  |
| Cleanup blocked     | A lifecycle condition where the old activation has not been proven ended                      | Prevents replacement until cleanup or verified execution reset succeeds                           |
| Replacement         | Explicitly ending an old installation/activation before admitting or activating its successor | Ordinary duplicate registration is never replacement                                              |
| Host-managed reload | Updating or restarting through the existing host's supported module/server lifecycle          | Adapter cleanup remains necessary; a Vite server restart does not terminate its Node process      |

## Calls and presentation

| Term                | Definition                                                                        | Distinction                                                                             |
| ------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Target              | The subject of an operation, with identity and generation                         | A replaced document is a new generation even when its tab is unchanged                  |
| Invocation          | One requested operation call with common target, cancellation and routing context | Contains business input separately from its execution target                            |
| Routing policy      | Rules selecting eligible providers before dispatch                                | Distinct from service construction and provider-state synchronization                   |
| Ambiguous selection | More than one equally eligible provider satisfies the current selector            | Requires an explicit caller/UI/agent discriminant; discovery order cannot pick a winner |
| Dispatch            | The routing boundary after which an invocation's selected route cannot change     | A timeout or reported failure does not authorize fallback or replay                     |
| Broadcast           | Explicit execution across several selected providers with individual outcomes     | Does not merge provider state or replace ordinary value-returning methods               |
| Diagnostic          | A serializable report identifying a failure's code, owner and phase               | Native exceptions remain local; diagnostics support logs and current/later UI           |
| View                | A declared JSON presentation and its bindings                                     | Its availability need not depend on every action it references                          |
| Renderer            | An implementation turning the JSON view contract into UI                          | Replaceable; its own framework does not become a dependency of authoring contracts      |
| UI surface          | Where a view is mounted, such as popup, options, panel or sidebar                 | Separate from realm, provider and execution ownership                                   |
| Live preview        | Built assets served with a live provider for actions and state                    | Separate from a static snapshot and from a source development server                    |

## Relationship summary

| Relationship                                                    | Meaning                                                                       |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| A provider implements a capability through a service definition | Contract and implementation stay separate                                     |
| A contribution requires capabilities                            | Typed bindings supply its dependencies                                        |
| A plugin contains contributions                                 | Dedicated properties preserve kind-specific typing                            |
| A host composes providers and clients                           | One UI can use a development server or extension provider according to policy |
| An adapter satisfies environment integration                    | Local native resources remain accessible without leaking across transport     |
| A renderer mounts views on surfaces                             | Presentation lifetimes remain separate from provider work                     |

## Authoring and routing identifiers

`defineActionContract({ id, version, operation })` describes a callable action. `defineAction({ contract, id, execution, requires?, handler })` implements it. `defineService({ capability, id, execution, requires?, setup })` implements a capability. All definition helpers use one object; “contribution” describes their shared ownership model, not a second action API.

A **route selector** constrains a required string `realm` and optional string `provider`. Its provider identity is scoped to that realm. Symbol descriptions and numbers are not normalized into identifiers. The caller owns stable naming; the runtime owns validation and collision detection. A selector identifies a logical provider, while a bound invocation retains one specific incarnation.
