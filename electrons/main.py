# Remove the faulty display function and re-run the visualization
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.animation as animation

# Constants
k_e = 8.988e9  # Coulomb's constant (Nm²/C²)
e = 1.602e-19  # Elementary charge (C)
m_e = 9.109e-31  # Electron mass (kg)

# Simulation settings
n_electrons = 10
box_size = 1e-6  # 1 micrometer box
dt = 1e-12  # time step
steps = 5000000

# Initial positions and velocities
np.random.seed(42)
positions = np.random.rand(n_electrons, 2) * box_size
velocities = (np.random.rand(n_electrons, 2) - 0.5) * 1e5  # m/s

def compute_forces(pos):
    forces = np.zeros_like(pos)
    for i in range(n_electrons):
        for j in range(i + 1, n_electrons):
            r_vec = pos[i] - pos[j]
            r = np.linalg.norm(r_vec)
            if r < 1e-12:
                continue
            force_magnitude = k_e * e**2 / r**2
            force_direction = r_vec / r
            f = force_magnitude * force_direction
            forces[i] += f
            forces[j] -= f  # Newton's third law
    return forces

# For visualization
trajectory = np.zeros((steps, n_electrons, 2))

# Velocity Verlet integration
for t in range(steps):
    forces = compute_forces(positions)
    accelerations = forces / m_e
    positions += velocities * dt + 0.5 * accelerations * dt**2
    new_forces = compute_forces(positions)
    new_accelerations = new_forces / m_e
    velocities += 0.5 * (accelerations + new_accelerations) * dt
    for i in range(n_electrons):
        for d in range(2):  # x and y
            if positions[i, d] <= 0:
                positions[i, d] = 0
                velocities[i, d] = -0.8*velocities[i, d]
            elif positions[i, d] >= box_size:
                positions[i, d] = box_size
                velocities[i, d] = -0.8*velocities[i, d]


    trajectory[t] = positions

# Visualization
fig, ax = plt.subplots()
sc = ax.scatter([], [], c='blue')
ax.set_xlim(0, box_size)
ax.set_ylim(0, box_size)
ax.set_title("Classical Electron Simulation")

def animate(i):
    sc.set_offsets(trajectory[i])
    return sc,

ani = animation.FuncAnimation(fig, animate, frames=steps, interval=0.01)
plt.show()
