import numpy as np
import matplotlib.pyplot as plt
import matplotlib.animation as animation
from numba import njit

# Constants
k_e = 8.988e9  # Coulomb's constant (Nm²/C²)
e = 1.602e-19  # Elementary charge (C)
m_e = 9.109e-31  # Electron mass (kg)

# Simulation settings
n_electrons = 10
box_size = 1e-6  # 1 micrometer box
dt = 1e-13  # time step
steps = 50000

# Initial positions and velocities
np.random.seed(42)
positions = np.random.rand(n_electrons, 2) * box_size
velocities = (np.random.rand(n_electrons, 2) - 0.5) * 4e4  # m/s

@njit
def compute_forces(pos):
    n = pos.shape[0]
    forces = np.zeros_like(pos)
    for i in range(n):
        for j in range(i + 1, n):
            r_vec = pos[i] - pos[j]
            r = np.sqrt(r_vec[0]**2 + r_vec[1]**2)
            if r < 1e-12:
                continue
            force_mag = k_e * e**2 / r**2
            force_dir = r_vec / r
            f = force_mag * force_dir
            forces[i] += f
            forces[j] -= f
    return forces

@njit
def verlet_step_single(pos, vel, dt, box_size):
    forces = compute_forces(pos)
    acc = forces / m_e
    pos += vel * dt + 0.5 * acc * dt**2
    new_forces = compute_forces(pos)
    new_acc = new_forces / m_e
    vel += 0.5 * (acc + new_acc) * dt

    for i in range(pos.shape[0]):
        for d in range(2):
            if pos[i, d] <= 0:
                pos[i, d] = 0
                vel[i, d] = -vel[i, d]*(1-1e-7*abs(vel[i, d]))
            elif pos[i, d] >= box_size:
                pos[i, d] = box_size
                vel[i, d] = -vel[i, d]*(1-1e-7*abs(vel[i, d]))
    return pos, vel

# Create plot
fig, ax = plt.subplots()
sc = ax.scatter(positions[:, 0], positions[:, 1], c='blue')
ax.set_xlim(0, box_size)
ax.set_ylim(0, box_size)
ax.set_title("Real-Time Electron Simulation")

# Store as mutable arrays
pos_shared = positions.copy()
vel_shared = velocities.copy()

def animate(i):
    global pos_shared, vel_shared
    pos_shared, vel_shared = verlet_step_single(pos_shared, vel_shared, dt, box_size)
    sc.set_offsets(pos_shared)
    return sc,

anim = animation.FuncAnimation(fig, animate, interval=1)
plt.show()
