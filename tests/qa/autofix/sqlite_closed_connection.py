def fetch_sample(connection):
    connection.close()
    return connection.execute("SELECT 1").fetchall()
