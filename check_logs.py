import time
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
import sys

def main():
    options = Options()
    options.add_argument('--headless')
    driver = webdriver.Chrome(options=options)
    
    print("Navigating to index...")
    driver.get("http://localhost:5500/index.html")
    
    print("Setting local storage...")
    driver.execute_script("localStorage.setItem('hr_logged_in', 'true'); localStorage.setItem('userRole', 'admin');")
    
    print("Navigating to admin-dashboard...")
    driver.get("http://localhost:5500/admin-dashboard.html")
    time.sleep(2)
    
    print("Browser logs:")
    logs = driver.get_log('browser')
    for log in logs:
        print(log)
        
    driver.quit()

if __name__ == "__main__":
    main()
