---
title: "Quantum Lattice Boltzmann as Denoising"
summary: "A simple but rigorous explanation of how a projection-based collision step can make quantum lattice Boltzmann simulations more coherent."
date: "2026-05-31"
tags: [quantum-computing, lattice-boltzmann, fluid-dynamics]
math: true
---

In this post, I want to share the main idea behind a recent paper I wrote with Matthias Moeller and Norbert Hosters, "Quantum Lattice Boltzmann with Denoising Collision Operators" [@duong2026qlbm]. The paper is technical, but the motivation is simple: if we want quantum computers to simulate fluids, we need a way to handle the part of fluid dynamics that looks least quantum.

The Lattice Boltzmann Method, or LBM, describes a fluid through particle populations living on a lattice. At each grid point, we store a small set of numbers $f_i(x,t)$, one for each discrete velocity direction $c_i$. A time step has two main pieces. First, collision changes the local populations so they relax toward an equilibrium distribution. Second, streaming moves each population to a neighboring lattice node along its velocity direction.

On a quantum computer, streaming is friendly. It is basically a reversible shift: if the velocity register says "move right", add one to the position register; if it says "move up", shift in that direction, and so on. Collision is the hard part. In classical LBM, the equilibrium distribution depends on density and velocity, and the velocity terms contain nonlinear products. The relaxation toward equilibrium is also dissipative: information is intentionally lost. Quantum gates, by contrast, are linear and reversible. This mismatch is the central obstacle.

Many quantum LBM approaches deal with this by interrupting the quantum evolution. They measure the state, reconstruct enough classical information, compute a new equilibrium, and prepare a fresh state. That can be useful for proofs of concept, but it pays a large measurement and state-preparation cost at every time step. Other approaches use larger linear embeddings, such as Carleman-type ideas, but those can lead to deep circuits and difficult resource requirements. Our question was: can we reinterpret the collision step so that it becomes closer to a quantum-native operation?

The answer we explore is to treat collision as denoising.

Here is the geometric picture. All equilibrium LBM populations form a surface, or manifold, inside the space of local population vectors. Each point on this manifold corresponds to an equilibrium determined by a density $\rho$ and velocity $u$. After streaming, the local state is generally nudged away from this equilibrium manifold. In classical LBM, collision pulls it back toward equilibrium. Instead of computing the full nonlinear pullback directly, we approximate the nearby equilibrium surface by its tangent space around a chosen reference velocity $\hat{u}$.

Then collision becomes an orthogonal projection.

More precisely, the quantum state stores square-root amplitudes of the particle populations. Locally, the velocity state has the form

$$
|\psi_x\rangle = \frac{1}{\sqrt{\rho(x)}} \sum_i \sqrt{f_i(x)} |e_i\rangle,
$$

where the $|e_i\rangle$ are one-hot velocity basis states. In this amplitude space, the equilibrium manifold is described by vectors of the form $\sqrt{f^{\mathrm{eq}}(\rho,u)}$. Around a reference velocity $\hat{u}$, we build a scaled Jacobian $\bar{J}(\hat{u})$ whose columns span the local linearization of this manifold. The denoising collision operator is the projector

$$
D(\hat{u}) = \bar{J}(\hat{u})\left(\bar{J}(\hat{u})^\top \bar{J}(\hat{u})\right)^{-1}\bar{J}(\hat{u})^\top.
$$

This is still an approximation, but it is a structured one. It keeps the components that look like changes in density and velocity near the reference state, and removes components orthogonal to that local equilibrium geometry. Calling it "denoising" is not just a metaphor: streaming perturbs the local amplitude vector, and the projection filters out the non-equilibrium part.

There are two useful checks on this idea. First, the projection respects the symmetries of the lattice. If we rotate or reflect the lattice and transform the reference velocity consistently, the collision operator transforms in the corresponding way. This matters because LBM relies heavily on lattice symmetry to recover the right macroscopic equations. Second, the paper gives error bounds. The collision error depends on how far the true post-streaming velocity is from $\hat{u}$, with a leading quadratic dependence on that mismatch, and it also depends on the local strain rate of the flow. In plain language: the method works best when the reference velocity tracks the flow and when the flow is not changing too violently across neighboring nodes.

The rest of the paper builds a full quantum pipeline around this operator. One-hot encoding is used for the velocity register, which makes streaming simple because each velocity direction can control a shift using a single qubit. The square-root encoding is also important: after streaming, measuring squared amplitudes gives the correct transported densities. If we encoded the raw $f_i$ values as amplitudes, the transport step would not reproduce standard LBM behavior.

The collision operator itself is not unitary, so it cannot be applied directly as a quantum gate. We implement it through block-encoding: embed the projector into a larger unitary acting on the velocity register plus an ancilla, then post-select on the successful ancilla outcome. At the gate level, the construction uses a combination of basis-changing unitaries, diagonal phases, and Givens rotations. The paper also includes circuits for boundary conditions. Periodic boundaries fit naturally with modular arithmetic, while bounce-back boundaries require combining streaming, direction reversal, a solid-node oracle, and collision into one step. This makes it possible to model walls and obstacles, including a cylinder test case.

The numerical experiments are encouraging, with some important caveats. For one-dimensional advection-diffusion with a Fourier-mode velocity, the method captures the phase shift and keeps the error small over long runs. For a Gaussian hill in two dimensions, it captures advection well, but diffusion is slightly underdamped, especially in low-Peclet regimes where diffusion dominates. For the Taylor-Green vortex, a zero reference velocity eventually becomes a good approximation as the vortex decays, but the early-time error is larger because the true velocity field is still far from zero. For flow around a cylinder, choosing $\hat{u} \approx (u_0/3,0)$, roughly the mean downstream flow, gives better agreement and stability than poorer reference choices.

That reference velocity is the main practical lever. The current experiments show that a good $\hat{u}$ can make the projection behave like a useful collision operator, while a bad one can visibly degrade the simulation. One natural next step is to make $\hat{u}$ position- and time-dependent, ideally without making the circuit depth explode. Another is to extend the framework beyond the full-relaxation setting used here, where $\tau = 1$, so that viscosity can be tuned more flexibly.

There is also a larger quantum-algorithmic issue: post-selection. Even if one collision step succeeds with high probability, repeated time steps multiply the failure probabilities. The paper shows that standard oblivious amplitude amplification does not solve this for an orthogonal projector. As an outlook, we describe a possible deterministic route using double-bracket quantum algorithms, replacing post-selected projection with a coherent evolution generated by $H = I - D$. This is not yet a near-term recipe, but it points toward fully coherent multi-step quantum LBM.

For me, the main message is that nonlinear physics does not always need to be imported into quantum algorithms by brute-force arithmetic. Sometimes the right move is geometric: identify the physical structure that the nonlinear step is enforcing, approximate that structure locally, and implement the approximation as a quantum-compatible operation. In this case, collision becomes denoising, and denoising becomes a projection.

The implementation is available on [GitHub](https://github.com/MyEntangled/denoise_qlbm), with an archived version on [Zenodo](https://doi.org/10.5281/zenodo.19482608).
