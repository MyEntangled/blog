---
title: "A surrogate model for nonlinear dynamics in the Lattice Boltzmann method"
summary: "A simple but rigorous explanation of how a projection-based collision step can make quantum lattice Boltzmann simulations more coherent."
date: "2026-05-31"
tags: [quantum-computing, lattice-boltzmann, fluid-dynamics]
math: true
---

In this post, I want to share the main idea behind a recent paper I wrote with
Matthias Moeller and Norbert Hosters, "Quantum Lattice Boltzmann with Denoising
Collision Operators" [@duong2026qlbm]. The paper is technical, but the motivation
is simple: if we want quantum computers to simulate fluids, we need a way to
handle the nonlinearity of fluid dynamics.

## Lattice Boltzmann method
The Lattice Boltzmann Method, or LBM, describes a fluid through particle
populations living on a lattice. The particles can only travel along a finite
predetermined set of velocities. At each grid point, we store a small set of
numbers $f_i(x,t)$, one for each discrete velocity direction $c_i$. LBM is a 
time-marching method whose individual time step involves two main dynamical processes. 
First, collision changes the local populations so they relax toward an equilibrium 
distribution. Second, streaming moves each population to a neighboring lattice node
along its velocity direction.

![Example of an LBM lattice](/media/qlbm/lbm-lattice.png "LBM lattice")

On a quantum computer, streaming is friendly. It is basically a reversible
shift: if the velocity register says "move right", add one to the x coordinate; 
if it says "move up", shift in that direction, and so on. Collision is
the hard part. In classical LBM, the equilibrium distribution depends on density
and velocity, and the velocity terms contain nonlinear products. The relaxation
toward equilibrium is also dissipative: information about the initial distribution
is lost. This poses the main difficulty for simulating the LBM on quantum computers 
since quantum operators, by contrast, are linear and reversible.

## Treatment of the nonlinear collision
Many quantum LBM approaches deal with this by interrupting the quantum
evolution. They measure the state, reconstruct enough classical information,
compute a new equilibrium, and prepare a fresh state. That can be useful for
proofs of concept, but it pays a large measurement and state-preparation cost at
every time step. Other approaches use larger linear embeddings, such as
Carleman-type ideas, but those can lead to deep circuits and difficult resource
requirements. Our question was whether we can reinterpret the collision step so 
that it becomes closer to a quantum-native operation?

The approach we explore is to treat initial distributions as out-of-equilibrium 
signals that undergo a denoising process as they relax back toward equilibrium. 
In this interpretation, the collision step implements that relaxation.

Geometrically, all equilibrium LBM populations form a 
high-dimensional smooth surface, or *manifold*, inside the space of local 
population vectors. Each point on this manifold corresponds to an equilibrium 
determined by a density $\rho$ and velocity $\mathbf{u}$. After streaming, the local state 
is generally nudged away from this equilibrium manifold. In classical LBM, collision 
pulls it back toward equilibrium. Instead of computing the full nonlinear pullback 
directly, we approximate the nearby equilibrium surface by its tangent space around a chosen
reference velocity $\hat{\mathbf{u}}$. Then collision is modelled as an orthogonal projection 
onto the tangent space.

More precisely, the quantum state stores square-root amplitudes of the particle
populations. We will not go into details about the encoding state, but it encodes 
vectors of the form $\sqrt{\mathbf{f}} = (\sqrt{f_1}, \dots, \sqrt{f_q})$, where $q$ 
is the size of the velocity set. The equilibrium manifold is described by vectors of the form
$\sqrt{\mathbf{f}^{\mathrm{eq}}(\rho,u)}$. Around a reference velocity $\hat{\mathbf{u}}$, we
build a Jacobian $J$ whose columns are partial derivatives with 
respect to $\rho$ and $\mathbf{u}$, which span the local linearization of this manifold. 
The denoising collision operator is the projector

$$
D(\hat{\mathbf{u}}) = J \left( J^\top J \right)^{-1} J^\top.
$$

As a projection onto the linearized manifold at $\hat{\mathbf{u}}$, this operator removes components orthogonal to the local equilibrium geometry. We called it a denoising operator as it filters out local non-equilibrium noise.

## Results and outlook
The rest of the paper analyzes the properties and errors of this operator and builds a full quantum pipeline around this operator. The collision operator itself is not unitary, so we implement it through block encoding with an ancilla. The paper also includes circuit implementations of multi-timestep LBM simulations with simple boundary conditions.

The numerical experiments are encouraging with an important caveat that reference velocity is the main practical lever. The current experiments
show that a good $\hat{\mathbf{u}}$ can make the projection behave like a useful collision operator, while a bad one can visibly degrade the simulation. One
natural next step is to make $\hat{\mathbf{u}}$ position- and time-dependent, ideally
without making the circuit depth explode. Another is to extend the framework
beyond the full-relaxation setting used here so that viscosity can be tuned more flexibly.

There is also a larger quantum-algorithmic issue that involves post-selection. Even if one
collision step succeeds with high probability, repeated time steps multiply the
failure probabilities. We show that standard oblivious amplitude
amplification does not solve this for an orthogonal projector. As an outlook, we
describe a possible deterministic route using double-bracket quantum algorithms,
replacing post-selected projection with a coherent evolution generated by $H = I - D$. This is not yet an efficient recipe, but it points toward fully coherent
multi-step quantum LBM.

For me, the main message is that nonlinear physics does not always need to be
imported into quantum algorithms by direct and sequential arithmetic. Sometimes it is possible to take advantage of the geometric structure that the nonlinear dynamics is enforcing. In this case, collision is interpreted as denoising, which is effectively approximated by a projection.

The implementation is available on [GitHub](https://github.com/MyEntangled/denoise_qlbm),
with an archived version on [Zenodo](https://doi.org/10.5281/zenodo.19482608).
